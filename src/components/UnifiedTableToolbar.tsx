/**
 * UnifiedTableToolbar — единый тулбар поиска + экспорта.
 * Используется в: DataGrid, TablePreviewModal, TableEditor.
 *
 * Дизайн: кнопки RegExp и выбор колонок — внутри поля ввода (справа).
 * Экспорт — единый dropdown. Слот extra — справа от поиска.
 */
import { useState, useRef, useEffect, useCallback } from 'react';
import {
  Search, X, Regex, Columns, Download,
  FileText, FileSpreadsheet, Check,
} from 'lucide-react';
import * as XLSX from 'xlsx';

export interface SearchState {
  query: string;
  useRegex: boolean;
  /** Пустой Set = все колонки */
  cols: Set<string>;
}

export interface UnifiedToolbarProps {
  columns: string[];
  onSearchChange: (s: SearchState) => void;
  exportData?: {
    rows: Record<string, unknown>[];
    columns: string[];
    filename: string;
  };
  rowCount: number;
  totalCount?: number;
  extra?: React.ReactNode;
  className?: string;
}

// ─── Export ──────────────────────────────────────────────────────────────────

export function doExportCSV(rows: Record<string, unknown>[], cols: string[], filename: string) {
  const BOM = '\uFEFF';
  const header = cols.map(c => `"${c.replace(/"/g, '""')}"`).join(',');
  const lines = rows.map(row =>
    cols.map(c => {
      const v = row[c];
      if (v === null || v === undefined) return '';
      const s = String(v);
      return s.match(/[",\n\r]/) ? `"${s.replace(/"/g, '""')}"` : s;
    }).join(',')
  );
  const csv = BOM + [header, ...lines].join('\r\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = `${filename}.csv`; a.click();
  URL.revokeObjectURL(url);
}

export function doExportXLSX(rows: Record<string, unknown>[], cols: string[], filename: string) {
  const data = [cols, ...rows.map(r => cols.map(c => r[c] ?? ''))];
  const ws = XLSX.utils.aoa_to_sheet(data);
  ws['!cols'] = cols.map(c => ({
    wch: Math.max(c.length, ...rows.slice(0, 100).map(r => String(r[c] ?? '').length), 8),
  }));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Data');
  XLSX.writeFile(wb, `${filename}.xlsx`);
}

// ─── Column Picker Popover ────────────────────────────────────────────────────

function ColPicker({
  columns, selected, onToggle, onClose,
}: {
  columns: string[]; selected: Set<string>;
  onToggle: (col: string) => void; onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const h = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) onClose(); };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, [onClose]);

  const allSelected = selected.size === 0;

  return (
    <div
      ref={ref}
      className="absolute top-full mt-2 right-0 z-50 bg-slate-800 border border-slate-600/80 rounded-xl shadow-2xl py-1.5 min-w-[200px] max-h-60 overflow-y-auto custom-scroll"
    >
      <div className="px-3 py-1.5 text-[10px] text-slate-400 font-semibold uppercase tracking-wider border-b border-slate-700 mb-1">
        Искать в колонках
      </div>
      {/* All columns */}
      <button
        className="w-full flex items-center gap-2.5 px-3 py-1.5 text-xs hover:bg-slate-700/60 transition-colors text-left"
        onClick={() => { columns.forEach(c => { if (selected.has(c)) onToggle(c); }); }}
      >
        <span className={`w-3.5 h-3.5 flex items-center justify-center rounded border flex-shrink-0 transition-colors ${
          allSelected ? 'border-blue-500 bg-blue-500' : 'border-slate-500'
        }`}>
          {allSelected && <Check size={9} className="text-white" />}
        </span>
        <span className="text-slate-300 font-medium">Все колонки</span>
      </button>
      <div className="h-px bg-slate-700/60 mx-2 my-1" />
      {columns.map(col => {
        const active = selected.has(col);
        return (
          <button
            key={col}
            className="w-full flex items-center gap-2.5 px-3 py-1.5 text-xs hover:bg-slate-700/60 transition-colors text-left"
            onClick={() => onToggle(col)}
          >
            <span className={`w-3.5 h-3.5 flex items-center justify-center rounded border flex-shrink-0 transition-colors ${
              active ? 'border-blue-500 bg-blue-500' : 'border-slate-600'
            }`}>
              {active && <Check size={9} className="text-white" />}
            </span>
            <span className="text-slate-300 truncate">{col}</span>
          </button>
        );
      })}
    </div>
  );
}

// ─── Export Popover ───────────────────────────────────────────────────────────

function ExportPopover({
  exportData, onClose,
}: {
  exportData: NonNullable<UnifiedToolbarProps['exportData']>; onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const h = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) onClose(); };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, [onClose]);

  return (
    <div
      ref={ref}
      className="absolute top-full mt-2 right-0 z-50 bg-slate-800 border border-slate-600/80 rounded-xl shadow-2xl py-1.5 min-w-[200px]"
    >
      <div className="px-3 py-1.5 text-[10px] text-slate-400 font-semibold uppercase tracking-wider border-b border-slate-700 mb-1">
        Сохранить как...
      </div>
      <button
        className="w-full flex items-center gap-3 px-3 py-2.5 text-xs text-slate-200 hover:bg-slate-700/60 transition-colors text-left"
        onClick={() => { doExportCSV(exportData.rows, exportData.columns, exportData.filename); onClose(); }}
      >
        <FileText size={15} className="text-green-400 flex-shrink-0" />
        <div>
          <div className="font-semibold">CSV</div>
          <div className="text-slate-500 text-[10px]">С BOM — корректно в Excel</div>
        </div>
      </button>
      <div className="h-px bg-slate-700/60 mx-2" />
      <button
        className="w-full flex items-center gap-3 px-3 py-2.5 text-xs text-slate-200 hover:bg-slate-700/60 transition-colors text-left"
        onClick={() => { doExportXLSX(exportData.rows, exportData.columns, exportData.filename); onClose(); }}
      >
        <FileSpreadsheet size={15} className="text-emerald-400 flex-shrink-0" />
        <div>
          <div className="font-semibold">Excel (.xlsx)</div>
          <div className="text-slate-500 text-[10px]">С авто-шириной колонок</div>
        </div>
      </button>
    </div>
  );
}

// ─── Main ─────────────────────────────────────────────────────────────────────

export function UnifiedTableToolbar({
  columns, onSearchChange, exportData,
  rowCount, totalCount, extra, className = '',
}: UnifiedToolbarProps) {
  const [query,         setQuery]         = useState('');
  const [useRegex,      setUseRegex]      = useState(false);
  const [regexError,    setRegexError]    = useState('');
  const [selectedCols,  setSelectedCols]  = useState<Set<string>>(new Set());
  const [showColPicker, setShowColPicker] = useState(false);
  const [showExport,    setShowExport]    = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const emit = useCallback((q: string, rx: boolean, cols: Set<string>) => {
    if (rx && q) {
      try { new RegExp(q); setRegexError(''); }
      catch (e: any) { setRegexError(e.message); return; }
    } else {
      setRegexError('');
    }
    onSearchChange({ query: q, useRegex: rx, cols });
  }, [onSearchChange]);

  const handleQuery  = (val: string)   => { setQuery(val); emit(val, useRegex, selectedCols); };
  const handleRegex  = (val: boolean)  => { setUseRegex(val); emit(query, val, selectedCols); inputRef.current?.focus(); };
  const handleToggle = (col: string)   => {
    setSelectedCols(prev => {
      const next = new Set(prev);
      next.has(col) ? next.delete(col) : next.add(col);
      emit(query, useRegex, next);
      return next;
    });
  };
  const clearAll = () => {
    setQuery(''); setUseRegex(false); setRegexError(''); setSelectedCols(new Set());
    onSearchChange({ query: '', useRegex: false, cols: new Set() });
    inputRef.current?.focus();
  };

  const hasFilter       = query.length > 0 || selectedCols.size > 0 || useRegex;
  const showingFiltered = totalCount !== undefined && rowCount !== totalCount;
  const colFilterActive = selectedCols.size > 0;

  return (
    <div className={`flex items-center gap-3 px-4 py-2 bg-slate-900/90 border-b border-slate-700/50 flex-shrink-0 ${className}`}>

      {/* ── Row counter ── */}
      <span className="text-[11px] tabular-nums flex-shrink-0 select-none text-slate-500">
        {showingFiltered ? (
          <>
            <span className="text-amber-400 font-bold">{rowCount.toLocaleString('ru-RU')}</span>
            <span className="mx-0.5">/</span>
            <span>{totalCount!.toLocaleString('ru-RU')}</span>
          </>
        ) : (
          <span className="text-slate-400 font-semibold">{rowCount.toLocaleString('ru-RU')}</span>
        )}
        <span className="ml-1 text-slate-600">строк</span>
      </span>

      <div className="w-px h-4 bg-slate-700/80 flex-shrink-0" />

      {/* ── Search input with embedded buttons ── */}
      <div className="relative flex-1 max-w-md min-w-0">

        {/* Left icon */}
        <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500 pointer-events-none z-10" />

        <input
          ref={inputRef}
          className={`w-full pl-8 py-1.5 text-[12px] rounded-lg outline-none transition-all
            ${regexError
              ? 'bg-red-500/10 border border-red-500/50 text-red-300 placeholder-red-400/40'
              : hasFilter
              ? 'bg-slate-700/80 border border-blue-500/40 text-slate-100 placeholder-slate-500 focus:border-blue-400'
              : 'bg-slate-800/80 border border-slate-700/60 text-slate-200 placeholder-slate-600 focus:border-slate-500 hover:border-slate-600'
            }
            ${/* right padding for buttons */ ''}
            pr-${colFilterActive ? '20' : '16'}
          `}
          style={{ paddingRight: colFilterActive ? '5.5rem' : '4.5rem' }}
          placeholder={useRegex ? '/regexp/i поиск...' : 'Поиск по таблице...'}
          value={query}
          onChange={e => handleQuery(e.target.value)}
          title={regexError || undefined}
        />

        {/* Right buttons inside input */}
        <div className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-0.5">
          {/* Clear */}
          {query && (
            <button
              className="p-0.5 text-slate-500 hover:text-slate-200 transition-colors rounded"
              onClick={clearAll}
              title="Очистить"
            >
              <X size={11} />
            </button>
          )}

          {/* Divider */}
          <div className="w-px h-3 bg-slate-600/80 mx-0.5" />

          {/* RegExp toggle */}
          <button
            title={useRegex ? 'RegExp включён (нажать — выключить)' : 'Включить RegExp поиск'}
            className={`p-1 rounded transition-colors ${
              useRegex
                ? 'text-amber-400 bg-amber-500/15'
                : 'text-slate-500 hover:text-slate-300 hover:bg-slate-700/60'
            }`}
            onClick={() => handleRegex(!useRegex)}
          >
            <Regex size={12} />
          </button>

          {/* Column filter toggle */}
          <div className="relative">
            <button
              title="Выбрать колонки для поиска"
              className={`flex items-center gap-0.5 p-1 rounded transition-colors ${
                colFilterActive
                  ? 'text-blue-400 bg-blue-500/15'
                  : 'text-slate-500 hover:text-slate-300 hover:bg-slate-700/60'
              }`}
              onClick={() => setShowColPicker(p => !p)}
            >
              <Columns size={12} />
              {colFilterActive && (
                <span className="text-[9px] font-bold leading-none">{selectedCols.size}</span>
              )}
            </button>
            {showColPicker && (
              <ColPicker
                columns={columns}
                selected={selectedCols}
                onToggle={handleToggle}
                onClose={() => setShowColPicker(false)}
              />
            )}
          </div>
        </div>

        {/* Regex error */}
        {regexError && (
          <div className="absolute top-full left-0 mt-1 z-50 px-2.5 py-1.5 bg-red-900/80 border border-red-700/60 rounded-lg text-[10px] text-red-300 whitespace-nowrap max-w-xs truncate shadow-lg">
            ⚠ {regexError}
          </div>
        )}
      </div>

      {/* Clear filters badge */}
      {hasFilter && (
        <button
          className="flex-shrink-0 text-[10px] text-slate-500 hover:text-slate-200 px-2 py-1 rounded-md hover:bg-slate-700/60 transition-colors"
          onClick={clearAll}
        >
          × Сбросить
        </button>
      )}

      {/* ── Extra slot ── */}
      {extra && (
        <>
          <div className="w-px h-4 bg-slate-700/80 flex-shrink-0" />
          <div className="flex items-center gap-1.5 flex-shrink-0">{extra}</div>
        </>
      )}

      {/* ── Export ── */}
      {exportData && (
        <>
          <div className="w-px h-4 bg-slate-700/80 flex-shrink-0" />
          <div className="relative flex-shrink-0">
            <button
              className="flex items-center gap-1.5 px-2.5 py-1.5 text-[11px] font-medium text-slate-300 hover:text-white bg-slate-800/80 hover:bg-slate-700 border border-slate-600/60 hover:border-slate-500 rounded-lg transition-all"
              onClick={() => setShowExport(p => !p)}
              title="Сохранить / экспортировать"
            >
              <Download size={12} />
              Сохранить
            </button>
            {showExport && (
              <ExportPopover
                exportData={exportData}
                onClose={() => setShowExport(false)}
              />
            )}
          </div>
        </>
      )}
    </div>
  );
}
