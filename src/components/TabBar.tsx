import { useState, useRef } from 'react';
import { Plus, X, Pencil, Check } from 'lucide-react';
import { useStore } from '../store/useStore';

export function TabBar() {
  const { pipelines, activeTabId, addPipeline, removePipeline, setActiveTab, renamePipeline, grandmaMode } = useStore();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  const startEdit = (id: string, name: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setEditingId(id);
    setEditDraft(name);
    setTimeout(() => inputRef.current?.select(), 50);
  };

  const commitEdit = () => {
    if (editingId && editDraft.trim()) {
      renamePipeline(editingId, editDraft.trim());
    }
    setEditingId(null);
  };

  return (
    <div className="flex items-center gap-0 bg-slate-900 border-b border-slate-700 px-2 overflow-x-auto custom-scroll-x flex-shrink-0">
      {pipelines.map((pipeline) => {
        const isActive = pipeline.id === activeTabId;
        const isEditing = editingId === pipeline.id;

        return (
          <div
            key={pipeline.id}
            className={`group flex items-center gap-2 px-3 py-2 cursor-pointer border-b-2 transition-all min-w-0 flex-shrink-0 max-w-48
              ${isActive
                ? 'border-blue-500 bg-slate-800 text-slate-100'
                : 'border-transparent text-slate-400 hover:text-slate-300 hover:bg-slate-800/50'
              }`}
            onClick={() => !isEditing && setActiveTab(pipeline.id)}
          >
            {isEditing ? (
              <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
                <input
                  ref={inputRef}
                  autoFocus
                  className="bg-slate-700 border border-blue-500 rounded px-1 py-0 text-xs text-slate-200 outline-none w-28"
                  value={editDraft}
                  onChange={(e) => setEditDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') commitEdit();
                    if (e.key === 'Escape') setEditingId(null);
                  }}
                  onBlur={commitEdit}
                />
                <button onClick={commitEdit} className="p-0.5 text-green-400"><Check size={11} /></button>
              </div>
            ) : (
              <>
                <span className="text-xs truncate">{pipeline.name}</span>
                <span className="text-[10px] text-slate-600 flex-shrink-0">
                  ({pipeline.steps.length})
                </span>
                <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0">
                  <button
                    className="p-0.5 text-slate-500 hover:text-slate-300 transition-colors"
                    onClick={(e) => startEdit(pipeline.id, pipeline.name, e)}
                    title="Переименовать"
                  >
                    <Pencil size={10} />
                  </button>
                  {pipelines.length > 1 && (
                    <button
                      className="p-0.5 text-slate-500 hover:text-red-400 transition-colors"
                      onClick={(e) => { e.stopPropagation(); removePipeline(pipeline.id); }}
                      title="Закрыть"
                    >
                      <X size={10} />
                    </button>
                  )}
                </div>
              </>
            )}
          </div>
        );
      })}

      <button
        className="flex items-center gap-1 px-3 py-2 text-slate-500 hover:text-slate-300 text-xs transition-colors flex-shrink-0"
        onClick={() => addPipeline()}
        title={grandmaMode ? 'Новый запрос' : 'New Pipeline'}
      >
        <Plus size={14} />
        <span className="hidden sm:inline">{grandmaMode ? 'Новый' : 'New'}</span>
      </button>
    </div>
  );
}
