/**
 * TableEditor — полноценный редактор таблиц.
 * FIXES:
 * - Sticky header: таблица обёрнута в отдельный div с overflow-auto,
 *   thead имеет sticky top-0 z-20, первые две колонки sticky left-0/left-8.
 *   Ключевое: контейнер таблицы НЕ является flex-item — фиксированная высота.
 * - Правое контекстное меню вместо мелких иконок (удобнее на всех экранах)
 * - Поиск с выбором колонок + опциональный regexp
 */
import { useState, useRef, useCallback, useMemo, useEffect } from 'react';
import {
  X, Plus, Trash2, Save, Hash, Type, Calendar, ToggleLeft,
  AlertCircle, ChevronLeft, ChevronRight,
  ArrowUp, ArrowDown, Copy, CheckSquare, Square,
  ArrowUpDown, GripVertical,
} from 'lucide-react';
import { useStore } from '../store/useStore';
import type { ColumnType, ColumnMeta } from '../types';
import { UnifiedTableToolbar, type SearchState } from './UnifiedTableToolbar';

interface Props {
  tableId: string;
  onClose: () => void;
}

// ── Types ─────────────────────────────────────────────────────────

const TYPE_OPTIONS: { value: ColumnType; label: string }[] = [
  { value: 'text',    label: 'Текст'       },
  { value: 'integer', label: 'Целое число' },
  { value: 'float',   label: 'Десятичное'  },
  { value: 'date',    label: 'Дата'        },
  { value: 'boolean', label: 'Да / Нет'   },
];

const TYPE_ICONS: Record<ColumnType, any> = {
  text: Type, integer: Hash, float: Hash, date: Calendar,
  boolean: ToggleLeft, unknown: Type,
};

const TYPE_COLORS: Record<ColumnType, string> = {
  text: 'text-slate-400', integer: 'text-blue-400', float: 'text-blue-300',
  date: 'text-green-400', boolean: 'text-purple-400', unknown: 'text-slate-500',
};

const PAGE_SIZE = 100;

// ── Helpers ───────────────────────────────────────────────────────

function validateCell(val: string, type: ColumnType): { ok: boolean; converted: any } {
  if (val === '' || val === null) return { ok: true, converted: null };
  switch (type) {
    case 'integer': {
      const n = parseInt(val, 10);
      return isNaN(n) ? { ok: false, converted: val } : { ok: true, converted: n };
    }
    case 'float': {
      const n = parseFloat(val.replace(',', '.'));
      return isNaN(n) ? { ok: false, converted: val } : { ok: true, converted: n };
    }
    case 'date': {
      const iso = /^\d{4}-\d{2}-\d{2}$/.test(val);
      const ru  = /^\d{2}\.\d{2}\.\d{4}$/.test(val);
      if (!iso && !ru) return { ok: false, converted: val };
      if (ru) {
        const [d, m, y] = val.split('.');
        return { ok: true, converted: `${y}-${m}-${d}` };
      }
      return { ok: true, converted: val };
    }
    case 'boolean':
      return { ok: true, converted: ['true','1','да','yes'].includes(val.toLowerCase()) };
    default:
      return { ok: true, converted: val };
  }
}

// ── TypeSelect ────────────────────────────────────────────────────

function TypeSelect({ value, onChange }: { value: ColumnType; onChange: (v: ColumnType) => void }) {
  const Icon  = TYPE_ICONS[value] ?? Type;
  const color = TYPE_COLORS[value] ?? 'text-slate-400';
  return (
    <div className={`flex items-center gap-0.5 ${color}`}>
      <Icon size={9} />
      <select
        className="appearance-none bg-transparent text-[10px] font-mono outline-none cursor-pointer"
        value={value}
        onChange={e => onChange(e.target.value as ColumnType)}
        title="Изменить тип"
      >
        {TYPE_OPTIONS.map(o => (
          <option key={o.value} value={o.value} className="bg-slate-800 text-slate-200">
            {o.label}
          </option>
        ))}
      </select>
    </div>
  );
}

// ── Context Menu ──────────────────────────────────────────────────

interface CtxMenu {
  x: number; y: number;
  rowIdx: number;   // global index
  colName?: string;
}

function ContextMenu({
  menu, onClose,
  onEdit, onDuplicate, onInsertAfter, onDelete,
  onMoveUp, onMoveDown,
  onRenameCol, onDeleteCol, onMoveColLeft, onMoveColRight, onAddCol,
}: {
  menu: CtxMenu;
  onClose: () => void;
  onEdit: () => void;
  onDuplicate: () => void;
  onInsertAfter: () => void;
  onDelete: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onRenameCol?: () => void;
  onDeleteCol?: () => void;
  onMoveColLeft?: () => void;
  onMoveColRight?: () => void;
  onAddCol: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const close = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) onClose();
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [onClose]);

  const sep = <div className="h-px bg-slate-700 my-1 mx-2" />;
  const item = (label: string, icon: React.ReactNode, onClick: () => void, cls = '') => (
    <button
      className={`w-full flex items-center gap-2.5 px-3 py-2 text-xs hover:bg-slate-700 transition-colors text-left ${cls || 'text-slate-200'}`}
      onClick={() => { onClick(); onClose(); }}
    >
      <span className="w-4 flex items-center justify-center text-slate-400">{icon}</span>
      {label}
    </button>
  );

  return (
    <div
      ref={ref}
      className="fixed z-[9999] bg-slate-800 border border-slate-600 rounded-xl shadow-2xl py-1.5 min-w-[200px]"
      style={{ left: menu.x, top: menu.y }}
    >
      {menu.colName && (
        <>
          <div className="px-3 py-1 text-[10px] text-slate-500 font-semibold uppercase tracking-wider">
            Колонка «{menu.colName}»
          </div>
          {item('Переименовать', <Type size={12}/>, onRenameCol ?? onClose)}
          {item('Переместить влево', <ChevronLeft size={12}/>, onMoveColLeft ?? onClose)}
          {item('Переместить вправо', <ChevronRight size={12}/>, onMoveColRight ?? onClose)}
          {item('Удалить колонку', <Trash2 size={12}/>, onDeleteCol ?? onClose, 'text-red-400')}
          {item('Добавить колонку справа', <Plus size={12}/>, onAddCol)}
          {sep}
          <div className="px-3 py-1 text-[10px] text-slate-500 font-semibold uppercase tracking-wider">
            Строка #{menu.rowIdx + 1}
          </div>
        </>
      )}
      {!menu.colName && (
        <div className="px-3 py-1 text-[10px] text-slate-500 font-semibold uppercase tracking-wider">
          Строка #{menu.rowIdx + 1}
        </div>
      )}
      {item('Редактировать ячейку', <Trash2 size={12}/>, onEdit)}
      {item('Дублировать строку', <Copy size={12}/>, onDuplicate)}
      {item('Вставить строку после', <Plus size={12}/>, onInsertAfter)}
      {sep}
      {item('Переместить вверх', <ArrowUp size={12}/>, onMoveUp)}
      {item('Переместить вниз', <ArrowDown size={12}/>, onMoveDown)}
      {sep}
      {item('Удалить строку', <Trash2 size={12}/>, onDelete, 'text-red-400')}
    </div>
  );
}

// ── Main Component ────────────────────────────────────────────────

export function TableEditor({ tableId, onClose }: Props) {
  const { sources, updateSource } = useStore();
  const originalTable = sources.find(s => s.id === tableId);

  const [cols, setCols]     = useState<ColumnMeta[]>(() =>
    originalTable ? originalTable.columns.map(c => ({ ...c })) : []
  );
  const [rows, setRows]     = useState<Record<string, any>[]>(() =>
    originalTable ? originalTable.rows.map(r => ({ ...r })) : []
  );
  const [tableName, setTableName]     = useState(originalTable?.name ?? 'Новая таблица');
  const [page, setPage]               = useState(0);
  const [editingCell, setEditingCell] = useState<{ row: number; col: string } | null>(null);
  const [editValue, setEditValue]     = useState('');
  const [cellErrors, setCellErrors]   = useState<Set<string>>(new Set());
  const [hasChanges, setHasChanges]   = useState(false);

  // Unified search state
  const [searchState, setSearchState] = useState<SearchState>({ query: '', useRegex: false, cols: new Set() });

  // Sort
  const [sortCol, setSortCol]         = useState<string | null>(null);
  const [sortDir, setSortDir]         = useState<'asc' | 'desc'>('asc');

  // Selection
  const [selected, setSelected]       = useState<Set<number>>(new Set());

  // Rename col
  const [renamingCol, setRenamingCol] = useState<string | null>(null);
  const [renameVal, setRenameVal]     = useState('');

  // Drag rows
  const [dragRow, setDragRow]         = useState<number | null>(null);
  const [dragOver, setDragOver]       = useState<number | null>(null);

  // Context menu
  const [ctxMenu, setCtxMenu]         = useState<CtxMenu | null>(null);

  const inputRef  = useRef<HTMLInputElement>(null);
  const renameRef = useRef<HTMLInputElement>(null);

  const markChanged = () => setHasChanges(true);

  // ── Search matcher via UnifiedTableToolbar state ──────────────
  const rowMatcher = useMemo(() => {
    const { query, useRegex, cols: sCols } = searchState;
    if (!query.trim()) return null;
    const targets = sCols.size > 0 ? cols.filter(c => sCols.has(c.name)) : cols;
    if (useRegex) {
      try { const re = new RegExp(query, 'i'); return (row: Record<string,any>) => targets.some(c => re.test(String(row[c.name] ?? ''))); }
      catch { return null; }
    }
    const q = query.toLowerCase();
    return (row: Record<string,any>) => targets.some(c => String(row[c.name] ?? '').toLowerCase().includes(q));
  }, [searchState, cols]);

  // ── Filtered + sorted ─────────────────────────────────────────
  const filteredIndices = useMemo(() => {
    let indices = rows.map((_, i) => i);
    if (rowMatcher) {
      indices = indices.filter(i => rowMatcher(rows[i]));
    }
    if (sortCol) {
      indices.sort((a, b) => {
        const av = rows[a][sortCol];
        const bv = rows[b][sortCol];
        const n  = typeof av === 'number' && typeof bv === 'number';
        const cmp = n ? av - bv : String(av ?? '').localeCompare(String(bv ?? ''), 'ru');
        return sortDir === 'asc' ? cmp : -cmp;
      });
    }
    return indices;
  }, [rows, rowMatcher, sortCol, sortDir]);

  const totalPages  = Math.ceil(filteredIndices.length / PAGE_SIZE);
  const pageIndices = filteredIndices.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

  // ── Cell editing ──────────────────────────────────────────────
  const startEdit = useCallback((globalIdx: number, colName: string) => {
    const val = rows[globalIdx]?.[colName];
    setEditingCell({ row: globalIdx, col: colName });
    setEditValue(val !== null && val !== undefined ? String(val) : '');
    setTimeout(() => inputRef.current?.select(), 20);
  }, [rows]);

  const commitEdit = useCallback(() => {
    if (!editingCell) return;
    const col = cols.find(c => c.name === editingCell.col);
    if (!col) { setEditingCell(null); return; }
    const { ok, converted } = validateCell(editValue, col.type);
    const key = `${editingCell.row}-${editingCell.col}`;
    if (!ok) { setCellErrors(prev => new Set(prev).add(key)); return; }
    setCellErrors(prev => { const s = new Set(prev); s.delete(key); return s; });
    setRows(prev => {
      const next = [...prev];
      next[editingCell.row] = { ...next[editingCell.row], [editingCell.col]: converted };
      return next;
    });
    setEditingCell(null);
    markChanged();
  }, [editingCell, editValue, cols]);

  const cancelEdit = () => { setEditingCell(null); setEditValue(''); };

  const handleCellKey = (e: React.KeyboardEvent, localPos: number, colIdx: number) => {
    if (e.key === 'Enter' || e.key === 'Tab') {
      e.preventDefault();
      commitEdit();
      if (e.key === 'Tab') {
        const nextCol = cols[colIdx + 1];
        if (nextCol) {
          const gIdx = pageIndices[localPos];
          setTimeout(() => startEdit(gIdx, nextCol.name), 30);
        }
      } else {
        const nextLocalPos = localPos + 1;
        if (nextLocalPos < pageIndices.length) {
          setTimeout(() => startEdit(pageIndices[nextLocalPos], cols[colIdx].name), 30);
        }
      }
    }
    if (e.key === 'Escape') cancelEdit();
  };

  // ── Column operations ─────────────────────────────────────────
  const addColumn = (afterName?: string) => {
    const name = `Колонка_${cols.length + 1}`;
    setCols(prev => {
      if (afterName) {
        const idx = prev.findIndex(c => c.name === afterName);
        const next = [...prev];
        next.splice(idx + 1, 0, { name, type: 'text' });
        return next;
      }
      return [...prev, { name, type: 'text' }];
    });
    setRows(prev => prev.map(r => ({ ...r, [name]: null })));
    markChanged();
  };

  const removeColumn = (colName: string) => {
    if (!confirm(`Удалить колонку «${colName}»?`)) return;
    setCols(prev => prev.filter(c => c.name !== colName));
    setRows(prev => prev.map(r => { const n = { ...r }; delete n[colName]; return n; }));
    markChanged();
  };

  const startRenameCol = (colName: string) => {
    setRenamingCol(colName);
    setRenameVal(colName);
    setTimeout(() => renameRef.current?.select(), 20);
  };

  const commitRenameCol = () => {
    if (!renamingCol || !renameVal.trim() || renameVal === renamingCol) {
      setRenamingCol(null); return;
    }
    const newName = renameVal.trim();
    setCols(prev => prev.map(c => c.name === renamingCol ? { ...c, name: newName } : c));
    setRows(prev => prev.map(r => {
      const n = { ...r };
      n[newName] = n[renamingCol!];
      delete n[renamingCol!];
      return n;
    }));
    setRenamingCol(null);
    markChanged();
  };

  const changeColType = (colName: string, type: ColumnType) => {
    setCols(prev => prev.map(c => c.name === colName ? { ...c, type } : c));
    markChanged();
  };

  const handleSortCol = (colName: string) => {
    if (sortCol === colName) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortCol(colName); setSortDir('asc'); }
    setPage(0);
  };

  const moveColLeft = (colName: string) => {
    setCols(prev => {
      const idx = prev.findIndex(c => c.name === colName);
      if (idx <= 0) return prev;
      const next = [...prev];
      [next[idx - 1], next[idx]] = [next[idx], next[idx - 1]];
      return next;
    });
    markChanged();
  };

  const moveColRight = (colName: string) => {
    setCols(prev => {
      const idx = prev.findIndex(c => c.name === colName);
      if (idx < 0 || idx >= prev.length - 1) return prev;
      const next = [...prev];
      [next[idx], next[idx + 1]] = [next[idx + 1], next[idx]];
      return next;
    });
    markChanged();
  };

  // ── Row operations ────────────────────────────────────────────
  const addRow = (afterGlobalIdx?: number) => {
    const newRow: Record<string, any> = {};
    cols.forEach(c => { newRow[c.name] = null; });
    if (afterGlobalIdx !== undefined) {
      setRows(prev => {
        const next = [...prev];
        next.splice(afterGlobalIdx + 1, 0, newRow);
        return next;
      });
    } else {
      setRows(prev => [...prev, newRow]);
      setPage(Math.floor((rows.length) / PAGE_SIZE));
    }
    markChanged();
  };

  const removeRow = (globalIdx: number) => {
    setRows(prev => prev.filter((_, i) => i !== globalIdx));
    setSelected(prev => {
      const s = new Set<number>();
      prev.forEach(i => { if (i < globalIdx) s.add(i); else if (i > globalIdx) s.add(i - 1); });
      return s;
    });
    markChanged();
  };

  const duplicateRow = (globalIdx: number) => {
    const copy = { ...rows[globalIdx] };
    setRows(prev => {
      const next = [...prev];
      next.splice(globalIdx + 1, 0, copy);
      return next;
    });
    markChanged();
  };

  const swapRows = (a: number, b: number) => {
    setRows(prev => {
      const next = [...prev];
      [next[a], next[b]] = [next[b], next[a]];
      return next;
    });
    markChanged();
  };

  // ── Selection ─────────────────────────────────────────────────
  const toggleSelect = (globalIdx: number) => {
    setSelected(prev => {
      const s = new Set(prev);
      s.has(globalIdx) ? s.delete(globalIdx) : s.add(globalIdx);
      return s;
    });
  };

  const toggleSelectAll = () => {
    if (pageIndices.every(i => selected.has(i))) {
      setSelected(prev => {
        const s = new Set(prev);
        pageIndices.forEach(i => s.delete(i));
        return s;
      });
    } else {
      setSelected(prev => {
        const s = new Set(prev);
        pageIndices.forEach(i => s.add(i));
        return s;
      });
    }
  };

  const deleteSelected = () => {
    if (!selected.size) return;
    if (!confirm(`Удалить ${selected.size} строк?`)) return;
    const toDelete = new Set(selected);
    setRows(prev => prev.filter((_, i) => !toDelete.has(i)));
    setSelected(new Set());
    setPage(0);
    markChanged();
  };

  // ── Drag rows ─────────────────────────────────────────────────
  const handleDrop = (globalIdx: number) => {
    if (dragRow !== null && dragRow !== globalIdx) swapRows(dragRow, globalIdx);
    setDragRow(null);
    setDragOver(null);
  };

  // ── Save / Export ─────────────────────────────────────────────
  const handleSave = () => {
    if (!originalTable) return;
    updateSource({ ...originalTable, name: tableName, columns: cols, rows, rowCount: rows.length });
    setHasChanges(false);
    onClose();
  };



  if (!originalTable) return null;

  const allPageSelected  = pageIndices.length > 0 && pageIndices.every(i => selected.has(i));
  const somePageSelected = pageIndices.some(i => selected.has(i));

  // ── Right-click handler ───────────────────────────────────────
  const openCtx = (e: React.MouseEvent, globalIdx: number, colName?: string) => {
    e.preventDefault();
    e.stopPropagation();
    const x = Math.min(e.clientX, window.innerWidth - 220);
    const y = Math.min(e.clientY, window.innerHeight - 320);
    setCtxMenu({ x, y, rowIdx: globalIdx, colName });
  };



  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="bg-slate-900 border border-slate-600 rounded-2xl shadow-2xl flex flex-col"
        style={{ width: 'min(98vw, 1280px)', height: 'min(92vh, 820px)' }}
        onClick={e => e.stopPropagation()}
      >

        {/* ── Header ──────────────────────────────────────────── */}
        <div className="flex items-center gap-3 px-5 py-3 border-b border-slate-700 flex-shrink-0 bg-slate-800/60 rounded-t-2xl">
          <input
            className="text-sm font-bold text-slate-100 bg-transparent border-b border-transparent hover:border-slate-500 focus:border-blue-500 outline-none px-1 py-0.5 min-w-[160px]"
            value={tableName}
            onChange={e => { setTableName(e.target.value); markChanged(); }}
            title="Название таблицы"
          />
          {hasChanges && (
            <span className="text-[10px] text-amber-400 bg-amber-500/10 border border-amber-500/30 px-2 py-0.5 rounded-full flex-shrink-0">
              Несохранённые изменения
            </span>
          )}
          <div className="flex-1" />
          {selected.size > 0 && (
            <button onClick={deleteSelected}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-red-400 hover:text-white hover:bg-red-600 border border-red-500/40 rounded-lg transition-colors flex-shrink-0"
            >
              <Trash2 size={12} /> Удалить {selected.size}
            </button>
          )}
          <button onClick={handleSave}
            className="flex items-center gap-1.5 px-4 py-1.5 text-xs font-semibold bg-blue-600 hover:bg-blue-500 text-white rounded-lg transition-colors flex-shrink-0"
          >
            <Save size={13} /> Сохранить
          </button>
          <button onClick={onClose} className="text-slate-500 hover:text-slate-200 ml-1 flex-shrink-0">
            <X size={16} />
          </button>
        </div>

        {/* ── Unified Toolbar (search + export) ───────────────── */}
        <UnifiedTableToolbar
          columns={cols.map(c => c.name)}
          onSearchChange={s => { setSearchState(s); setPage(0); }}
          rowCount={filteredIndices.length}
          totalCount={rows.length}
          exportData={{ rows: filteredIndices.map(i => rows[i]), columns: cols.map(c => c.name), filename: tableName }}
          extra={
            <>
              <button onClick={() => addRow()}
                className="flex items-center gap-1 px-2.5 py-1 text-xs text-slate-400 hover:text-green-300 hover:bg-green-500/10 border border-slate-700 hover:border-green-500/40 rounded-lg transition-colors"
              >
                <Plus size={11} /> Строка
              </button>
              <button onClick={() => addColumn()}
                className="flex items-center gap-1 px-2.5 py-1 text-xs text-slate-400 hover:text-blue-300 hover:bg-blue-500/10 border border-slate-700 hover:border-blue-500/40 rounded-lg transition-colors"
              >
                <Plus size={11} /> Колонка
              </button>
              {sortCol && (
                <button onClick={() => { setSortCol(null); setSortDir('asc'); }}
                  className="flex items-center gap-1 px-2.5 py-1 text-xs text-amber-400 hover:text-amber-300 hover:bg-amber-500/10 border border-amber-500/30 rounded-lg transition-colors"
                >
                  <ArrowUpDown size={11} /> Сброс сорт.
                </button>
              )}
              <span className="text-[10px] text-slate-600 hidden xl:block pl-1">
                ✏️ Двойной клик · 🖱️ ПКМ · ↕️ Drag
              </span>
            </>
          }
        />

        {/* ── Grid ────────────────────────────────────────────── */}
        <div className="flex-1 min-h-0 overflow-auto custom-scroll">
          <table className="border-collapse text-xs" style={{ minWidth: '100%', tableLayout: 'fixed' }}>

            {/* ── Column Headers — sticky top-0 ── */}
            <thead className="sticky top-0 z-20">
              <tr className="bg-slate-800">

                {/* Checkbox col — sticky left-0 */}
                <th className="border-r border-b border-slate-700 bg-slate-800 sticky left-0 z-30"
                  style={{ width: 32, minWidth: 32 }}>
                  <div className="flex items-center justify-center h-full px-1 py-2">
                    <button onClick={toggleSelectAll}
                      className="text-slate-500 hover:text-slate-200"
                      title="Выбрать всю страницу"
                    >
                      {allPageSelected
                        ? <CheckSquare size={12} className="text-blue-400" />
                        : somePageSelected
                          ? <CheckSquare size={12} className="text-slate-500 opacity-50" />
                          : <Square size={12} />
                      }
                    </button>
                  </div>
                </th>

                {/* Row # col — sticky left-8 */}
                <th className="border-r border-b border-slate-700 bg-slate-800 text-[10px] text-slate-600 font-normal sticky left-8 z-30"
                  style={{ width: 48, minWidth: 48 }}>
                  <div className="px-2 py-2">#</div>
                </th>

                {/* Data cols */}
                {cols.map(col => {
                  const isSorted = sortCol === col.name;
                  return (
                    <th
                      key={col.name}
                      className="border-r border-b border-slate-700 bg-slate-800 text-left group relative"
                      style={{ minWidth: 150, width: 150 }}
                      onContextMenu={e => {
                        // Column header right click — show column actions
                        e.preventDefault();
                        const x = Math.min(e.clientX, window.innerWidth - 220);
                        const y = Math.min(e.clientY, window.innerHeight - 300);
                        setCtxMenu({ x, y, rowIdx: -1, colName: col.name });
                      }}
                    >
                      <div className="flex flex-col px-2 py-1 gap-0.5">
                        <div className="flex items-center gap-1">
                          {renamingCol === col.name ? (
                            <input
                              ref={renameRef}
                              autoFocus
                              className="flex-1 bg-blue-600/20 border border-blue-500 rounded px-1 text-xs text-slate-100 outline-none min-w-0"
                              value={renameVal}
                              onChange={e => setRenameVal(e.target.value)}
                              onBlur={commitRenameCol}
                              onKeyDown={e => {
                                if (e.key === 'Enter') commitRenameCol();
                                if (e.key === 'Escape') setRenamingCol(null);
                              }}
                            />
                          ) : (
                            <span
                              className="flex-1 text-slate-200 font-semibold text-xs truncate cursor-pointer hover:text-white"
                              title="Двойной клик — переименовать, правый клик — меню"
                              onDoubleClick={() => startRenameCol(col.name)}
                            >
                              {col.name}
                            </span>
                          )}
                          <button
                            onClick={() => handleSortCol(col.name)}
                            className={`flex-shrink-0 transition-colors ${
                              isSorted ? 'text-blue-400' : 'opacity-0 group-hover:opacity-100 text-slate-600 hover:text-slate-300'
                            }`}
                            title="Сортировать"
                          >
                            {isSorted
                              ? (sortDir === 'asc' ? <ArrowUp size={10} /> : <ArrowDown size={10} />)
                              : <ArrowUpDown size={10} />
                            }
                          </button>
                        </div>
                        <TypeSelect value={col.type} onChange={t => changeColType(col.name, t)} />
                      </div>
                    </th>
                  );
                })}

                {/* Add column button */}
                <th className="border-b border-slate-700 bg-slate-800" style={{ width: 40, minWidth: 40 }}>
                  <button
                    onClick={() => addColumn()}
                    className="w-full h-full flex items-center justify-center text-slate-600 hover:text-green-400 hover:bg-green-500/10 p-2"
                    title="Добавить колонку"
                  >
                    <Plus size={13} />
                  </button>
                </th>
              </tr>
            </thead>

            {/* ── Body ── */}
            <tbody>
              {pageIndices.length === 0 && (
                <tr>
                  <td colSpan={cols.length + 3} className="text-center py-12 text-slate-600 text-sm">
                    {searchState.query ? 'Ничего не найдено' : 'Таблица пуста'}
                  </td>
                </tr>
              )}

              {pageIndices.map((globalIdx, localPos) => {
                const row        = rows[globalIdx];
                const isSelected = selected.has(globalIdx);
                const isDragOver = dragOver === globalIdx;
                const isEven     = localPos % 2 === 0;

                const rowCls = isDragOver
                  ? 'border-t-2 border-blue-400 bg-blue-500/5'
                  : isSelected
                    ? 'bg-blue-500/10'
                    : isEven ? 'bg-slate-950' : 'bg-slate-900/50';

                return (
                  <tr
                    key={globalIdx}
                    draggable
                    onDragStart={() => setDragRow(globalIdx)}
                    onDragOver={e => { e.preventDefault(); setDragOver(globalIdx); }}
                    onDrop={() => handleDrop(globalIdx)}
                    onDragEnd={() => { setDragRow(null); setDragOver(null); }}
                    onContextMenu={e => openCtx(e, globalIdx)}
                    className={`group transition-colors ${rowCls} hover:bg-blue-500/5`}
                  >
                    {/* Checkbox — sticky left-0 */}
                    <td className="border-r border-b border-slate-800 text-center sticky left-0 z-10 bg-inherit"
                      style={{ width: 32, minWidth: 32 }}>
                      <button onClick={() => toggleSelect(globalIdx)}
                        className="text-slate-600 hover:text-blue-400 transition-colors w-full flex items-center justify-center py-2"
                      >
                        {isSelected
                          ? <CheckSquare size={12} className="text-blue-400" />
                          : <Square size={12} className="opacity-0 group-hover:opacity-100" />
                        }
                      </button>
                    </td>

                    {/* Row # + drag handle — sticky left-8 */}
                    <td className="border-r border-b border-slate-800 text-center sticky left-8 z-10 bg-inherit"
                      style={{ width: 48, minWidth: 48 }}>
                      <div className="flex items-center justify-center gap-0.5 px-1 py-1.5">
                        <span className="text-[10px] text-slate-600 group-hover:hidden tabular-nums">
                          {globalIdx + 1}
                        </span>
                        <div className="hidden group-hover:flex items-center gap-0.5">
                          <div className="flex flex-col">
                            <button
                              onClick={() => globalIdx > 0 && swapRows(globalIdx, globalIdx - 1)}
                              disabled={globalIdx === 0}
                              className="text-slate-600 hover:text-slate-200 disabled:opacity-20"
                            >
                              <ArrowUp size={9} />
                            </button>
                            <button
                              onClick={() => globalIdx < rows.length - 1 && swapRows(globalIdx, globalIdx + 1)}
                              disabled={globalIdx === rows.length - 1}
                              className="text-slate-600 hover:text-slate-200 disabled:opacity-20"
                            >
                              <ArrowDown size={9} />
                            </button>
                          </div>
                          <GripVertical size={10} className="text-slate-600 cursor-grab active:cursor-grabbing" />
                        </div>
                      </div>
                    </td>

                    {/* Data cells */}
                    {cols.map((col, colIdx) => {
                      const isEditing = editingCell?.row === globalIdx && editingCell?.col === col.name;
                      const val       = row?.[col.name];
                      const key       = `${globalIdx}-${col.name}`;
                      const hasErr    = cellErrors.has(key);
                      const isNum     = col.type === 'integer' || col.type === 'float';
                      const displayVal = val !== null && val !== undefined ? String(val) : '';

                      return (
                        <td
                          key={col.name}
                          className={`border-r border-b border-slate-800 ${hasErr ? 'bg-red-500/10' : ''}`}
                          style={{ minWidth: 150, width: 150 }}
                          onDoubleClick={() => startEdit(globalIdx, col.name)}
                          onContextMenu={e => openCtx(e, globalIdx, col.name)}
                        >
                          {isEditing ? (
                            <div className="flex items-center gap-1 px-1 py-0.5">
                              {hasErr && <AlertCircle size={11} className="text-red-400 flex-shrink-0" />}
                              <input
                                ref={inputRef}
                                autoFocus
                                className={`flex-1 bg-blue-600/20 border ${hasErr ? 'border-red-500' : 'border-blue-500'} rounded px-2 py-1 text-xs text-slate-100 outline-none font-mono min-w-0`}
                                value={editValue}
                                onChange={e => {
                                  setEditValue(e.target.value);
                                  const { ok } = validateCell(e.target.value, col.type);
                                  setCellErrors(prev => {
                                    const s = new Set(prev);
                                    ok ? s.delete(key) : s.add(key);
                                    return s;
                                  });
                                }}
                                onBlur={commitEdit}
                                onKeyDown={e => handleCellKey(e, localPos, colIdx)}
                              />
                            </div>
                          ) : (
                            <div
                              className={`px-2 py-1.5 cursor-text hover:bg-blue-500/10 transition-colors min-h-[30px] select-none ${
                                val === null || val === undefined
                                  ? 'text-slate-700 italic text-[10px]'
                                  : isNum
                                    ? 'text-blue-300 text-right font-mono tabular-nums'
                                    : 'text-slate-300'
                              }`}
                              title="Двойной клик для редактирования, правый клик — меню"
                            >
                              {displayVal || <span>пусто</span>}
                            </div>
                          )}
                        </td>
                      );
                    })}

                    <td className="border-b border-slate-800" style={{ width: 40 }} />
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* ── Footer ──────────────────────────────────────────── */}
        <div className="flex items-center gap-3 px-4 py-2 border-t border-slate-700 bg-slate-800/50 flex-shrink-0 rounded-b-2xl">
          <button onClick={() => addRow()}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-slate-400 hover:text-green-300 hover:bg-green-500/10 border border-slate-700 hover:border-green-500/40 rounded-lg transition-colors"
          >
            <Plus size={12} /> Новая строка
          </button>
          <button onClick={() => addColumn()}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-slate-400 hover:text-blue-300 hover:bg-blue-500/10 border border-slate-700 hover:border-blue-500/40 rounded-lg transition-colors"
          >
            <Plus size={12} /> Новая колонка
          </button>

          <div className="flex-1" />

          {selected.size > 0 && (
            <span className="text-[11px] text-blue-400">Выбрано: {selected.size}</span>
          )}

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex items-center gap-1">
              <button disabled={page === 0} onClick={() => setPage(0)}
                className="p-1 text-slate-500 hover:text-slate-200 disabled:opacity-30 text-xs" title="Первая">«</button>
              <button disabled={page === 0} onClick={() => setPage(p => p - 1)}
                className="p-1 text-slate-500 hover:text-slate-200 disabled:opacity-30">
                <ChevronLeft size={14} />
              </button>
              <span className="text-xs text-slate-400 min-w-[90px] text-center">
                {page + 1} / {totalPages}
                <span className="text-slate-600 ml-1">({filteredIndices.length})</span>
              </span>
              <button disabled={page >= totalPages - 1} onClick={() => setPage(p => p + 1)}
                className="p-1 text-slate-500 hover:text-slate-200 disabled:opacity-30">
                <ChevronRight size={14} />
              </button>
              <button disabled={page >= totalPages - 1} onClick={() => setPage(totalPages - 1)}
                className="p-1 text-slate-500 hover:text-slate-200 disabled:opacity-30 text-xs" title="Последняя">»</button>
            </div>
          )}
        </div>
      </div>

      {/* Context Menu */}
      {ctxMenu && ctxMenu.rowIdx >= 0 && (
        <ContextMenu
          menu={ctxMenu}
          onClose={() => setCtxMenu(null)}
          onEdit={() => ctxMenu.colName && startEdit(ctxMenu.rowIdx, ctxMenu.colName)}
          onDuplicate={() => duplicateRow(ctxMenu.rowIdx)}
          onInsertAfter={() => addRow(ctxMenu.rowIdx)}
          onDelete={() => removeRow(ctxMenu.rowIdx)}
          onMoveUp={() => ctxMenu.rowIdx > 0 && swapRows(ctxMenu.rowIdx, ctxMenu.rowIdx - 1)}
          onMoveDown={() => ctxMenu.rowIdx < rows.length - 1 && swapRows(ctxMenu.rowIdx, ctxMenu.rowIdx + 1)}
          onRenameCol={ctxMenu.colName ? () => startRenameCol(ctxMenu.colName!) : undefined}
          onDeleteCol={ctxMenu.colName ? () => removeColumn(ctxMenu.colName!) : undefined}
          onMoveColLeft={ctxMenu.colName ? () => moveColLeft(ctxMenu.colName!) : undefined}
          onMoveColRight={ctxMenu.colName ? () => moveColRight(ctxMenu.colName!) : undefined}
          onAddCol={() => addColumn(ctxMenu.colName)}
        />
      )}

      {/* Context menu for column header (rowIdx = -1) */}
      {ctxMenu && ctxMenu.rowIdx === -1 && ctxMenu.colName && (
        <div
          className="fixed z-[9999] bg-slate-800 border border-slate-600 rounded-xl shadow-2xl py-1.5 min-w-[200px]"
          style={{ left: ctxMenu.x, top: ctxMenu.y }}
          onMouseLeave={() => setCtxMenu(null)}
        >
          <div className="px-3 py-1 text-[10px] text-slate-500 font-semibold uppercase tracking-wider">
            Колонка «{ctxMenu.colName}»
          </div>
          {[
            ['Переименовать', () => startRenameCol(ctxMenu.colName!)],
            ['Переместить влево', () => moveColLeft(ctxMenu.colName!)],
            ['Переместить вправо', () => moveColRight(ctxMenu.colName!)],
            ['Добавить колонку справа', () => addColumn(ctxMenu.colName)],
          ].map(([label, fn]: any) => (
            <button key={label}
              className="w-full flex items-center gap-2 px-3 py-2 text-xs text-slate-200 hover:bg-slate-700 transition-colors text-left"
              onClick={() => { fn(); setCtxMenu(null); }}
            >{label as string}</button>
          ))}
          <div className="h-px bg-slate-700 my-1 mx-2" />
          <button
            className="w-full flex items-center gap-2 px-3 py-2 text-xs text-red-400 hover:bg-slate-700 transition-colors text-left"
            onClick={() => { removeColumn(ctxMenu.colName!); setCtxMenu(null); }}
          >Удалить колонку</button>
        </div>
      )}
    </div>
  );
}
