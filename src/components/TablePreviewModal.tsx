import { useState, useRef, useCallback, useLayoutEffect, useMemo } from 'react';
import { X, Hash, Type, Calendar } from 'lucide-react';
import type { TableMetadata, ColumnMeta } from '../types';
import { UnifiedTableToolbar, type SearchState } from './UnifiedTableToolbar';

const COL_WIDTH   = 150;
const ROW_HEIGHT  = 32;
const OVERSCAN    = 6;

function TypeBadge({ type }: { type: string }) {
  if (type === 'integer' || type === 'float')
    return <Hash size={9} className="text-blue-400 flex-shrink-0" />;
  if (type === 'date')
    return <Calendar size={9} className="text-green-400 flex-shrink-0" />;
  return <Type size={9} className="text-slate-400 flex-shrink-0" />;
}

function formatVal(val: unknown, type: string): string {
  if (val === null || val === undefined) return '—';
  if ((type === 'float' || type === 'integer') && typeof val === 'number')
    return val.toLocaleString('ru-RU', { maximumFractionDigits: 2 });
  return String(val);
}

interface Props {
  table: TableMetadata;
  onClose: () => void;
  onUseInPipeline?: () => void;
}

function buildMatcher(s: SearchState): ((row: Record<string, unknown>, cols: ColumnMeta[]) => boolean) | null {
  if (!s.query.trim()) return null;
  const activeCols = s.cols.size > 0 ? null : 'all'; // null = filtered list
  if (s.useRegex) {
    try {
      const re = new RegExp(s.query, 'i');
      return (row, cols) => {
        const targets = activeCols === 'all' ? cols : cols.filter(c => s.cols.has(c.name));
        return targets.some(c => re.test(String(row[c.name] ?? '')));
      };
    } catch { return null; }
  }
  const q = s.query.toLowerCase();
  return (row, cols) => {
    const targets = activeCols === 'all' ? cols : cols.filter(c => s.cols.has(c.name));
    return targets.some(c => String(row[c.name] ?? '').toLowerCase().includes(q));
  };
}

export function TablePreviewModal({ table, onClose, onUseInPipeline }: Props) {
  const [search, setSearch] = useState<SearchState>({ query: '', useRegex: false, cols: new Set() });

  // Virtual scroll — pure refs
  const outerRef  = useRef<HTMLDivElement>(null);
  const headerRef = useRef<HTMLDivElement>(null);
  const bodyRef   = useRef<HTMLDivElement>(null);
  const rafRef    = useRef(0);
  const scrollRef = useRef({ top: 0, left: 0, h: 400 });

  const colsMeta: ColumnMeta[] = table.columns;
  const totalWidth = colsMeta.length * COL_WIDTH + 48;

  const matcher = useMemo(() => buildMatcher(search), [search]);

  const filteredRows = useMemo(() => {
    if (!matcher) return table.rows;
    return table.rows.filter(row => matcher(row, colsMeta));
  }, [matcher, table.rows, colsMeta]);

  // Render rows imperatively
  const renderRows = useCallback(() => {
    const body = bodyRef.current;
    if (!body) return;
    const { top, h } = scrollRef.current;
    const startIdx = Math.max(0, Math.floor(top / ROW_HEIGHT) - OVERSCAN);
    const visible  = Math.ceil(Math.max(h, 100) / ROW_HEIGHT) + OVERSCAN * 2;
    const endIdx   = Math.min(filteredRows.length - 1, startIdx + visible);
    const offsetY  = startIdx * ROW_HEIGHT;
    body.style.transform = `translateY(${offsetY}px)`;

    let html = '';
    for (let i = startIdx; i <= endIdx; i++) {
      const row = filteredRows[i];
      const even = i % 2 === 0;
      const bg = even ? 'background:rgba(15,23,42,0.3)' : 'background:rgb(2,6,23)';
      html += `<div class="flex" style="height:${ROW_HEIGHT}px;width:${totalWidth}px;${bg}">`;
      html += `<div style="width:48px;min-width:48px;flex-shrink:0;display:flex;align-items:center;padding:0 8px;border-right:1px solid rgba(51,65,85,0.4);border-bottom:1px solid rgba(51,65,85,0.3);font-size:10px;color:rgb(71,85,105);font-variant-numeric:tabular-nums">${i + 1}</div>`;
      for (const col of colsMeta) {
        const val = row[col.name];
        const isNum = col.type === 'integer' || col.type === 'float';
        const nullish = val === null || val === undefined;
        const textColor = nullish
          ? 'color:rgb(71,85,105);font-style:italic'
          : isNum
          ? 'color:rgb(147,197,253);font-variant-numeric:tabular-nums;text-align:right'
          : 'color:rgb(226,232,240)';
        const formatted = nullish ? '—' : formatVal(val, col.type);
        html += `<div style="width:${COL_WIDTH}px;min-width:${COL_WIDTH}px;flex-shrink:0;display:flex;align-items:center;padding:0 12px;border-right:1px solid rgba(51,65,85,0.3);border-bottom:1px solid rgba(51,65,85,0.3);height:${ROW_HEIGHT}px;overflow:hidden;">`;
        html += `<span style="font-size:12px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;width:100%;${textColor}">${String(formatted).replace(/</g,'&lt;')}</span>`;
        html += `</div>`;
      }
      html += `</div>`;
    }
    body.innerHTML = html;
  }, [filteredRows, colsMeta, totalWidth]);

  const syncHeader = useCallback(() => {
    if (headerRef.current)
      headerRef.current.style.transform = `translateX(-${scrollRef.current.left}px)`;
  }, []);

  const onScroll = useCallback(() => {
    cancelAnimationFrame(rafRef.current);
    rafRef.current = requestAnimationFrame(() => {
      const el = outerRef.current;
      if (!el) return;
      scrollRef.current.top  = el.scrollTop;
      scrollRef.current.left = el.scrollLeft;
      renderRows();
      syncHeader();
    });
  }, [renderRows, syncHeader]);

  useLayoutEffect(() => {
    const el = outerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      scrollRef.current.h = el.clientHeight;
      renderRows();
    });
    ro.observe(el);
    scrollRef.current.h = el.clientHeight;
    renderRows();
    return () => ro.disconnect();
  }, [renderRows]);

  // Re-render when filtered data changes
  useLayoutEffect(() => {
    scrollRef.current.top = 0;
    if (outerRef.current) outerRef.current.scrollTop = 0;
    renderRows();
  }, [filteredRows, renderRows]);

  const sourceBadge = {
    virtual: { label: 'Виртуальная', cls: 'bg-purple-500/20 text-purple-400 border-purple-500/30' },
    csv:     { label: 'CSV',         cls: 'bg-green-500/20  text-green-400  border-green-500/30'  },
    demo:    { label: 'Demo',        cls: 'bg-blue-500/20   text-blue-400   border-blue-500/30'   },
    xlsx:    { label: 'Excel',       cls: 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30'},
    manual:  { label: 'Вручную',     cls: 'bg-slate-500/20  text-slate-400  border-slate-500/30'  },
  }[table.sourceType] ?? { label: table.sourceType, cls: 'bg-slate-500/20 text-slate-400 border-slate-500/30' };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4"
      onClick={onClose}
    >
      <div
        className="bg-slate-900 border border-slate-700 rounded-2xl shadow-2xl flex flex-col"
        style={{ width: '88vw', maxWidth: 1200, height: '82vh' }}
        onClick={e => e.stopPropagation()}
      >
        {/* ── Header ── */}
        <div className="flex items-center gap-3 px-5 py-3 border-b border-slate-700 flex-shrink-0">
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-sm font-semibold text-slate-200 truncate">{table.name}</span>
              <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium border ${sourceBadge.cls}`}>
                {sourceBadge.label}
              </span>
            </div>
            <p className="text-[11px] text-slate-500 mt-0.5">
              {colsMeta.length} колонок · {table.rows.length.toLocaleString('ru-RU')} строк всего
            </p>
          </div>

          <div className="flex-1" />

          {onUseInPipeline && (
            <button
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-blue-600 hover:bg-blue-500 text-white rounded-lg transition-colors flex-shrink-0"
              onClick={() => { onUseInPipeline(); onClose(); }}
            >
              Открыть в пайплайне
            </button>
          )}
          <button
            className="p-1.5 text-slate-400 hover:text-slate-200 hover:bg-slate-700 rounded-lg transition-colors flex-shrink-0"
            onClick={onClose}
          >
            <X size={16} />
          </button>
        </div>

        {/* ── Schema strip ── */}
        <div className="flex gap-1.5 px-4 py-2 border-b border-slate-700/50 overflow-x-auto custom-scroll flex-shrink-0 bg-slate-900/50">
          {colsMeta.map(col => (
            <div key={col.name} className="flex items-center gap-1 flex-shrink-0 bg-slate-800 rounded-lg px-2 py-1">
              <TypeBadge type={col.type} />
              <span className="text-[11px] text-slate-300">{col.name}</span>
            </div>
          ))}
        </div>

        {/* ── Unified toolbar ── */}
        <UnifiedTableToolbar
          columns={colsMeta.map(c => c.name)}
          onSearchChange={setSearch}
          rowCount={filteredRows.length}
          totalCount={table.rows.length}
          exportData={{
            rows: filteredRows,
            columns: colsMeta.map(c => c.name),
            filename: table.name,
          }}
        />

        {/* ── Virtual grid ── */}
        <div className="flex flex-col flex-1 min-h-0 overflow-hidden">
          {/* Fixed header */}
          <div
            className="flex-shrink-0 overflow-hidden bg-slate-800 border-b border-slate-600 select-none"
            style={{ height: 36 }}
          >
            <div ref={headerRef} className="flex" style={{ width: totalWidth }}>
              <div className="flex-shrink-0 flex items-center px-2 border-r border-slate-700 text-[10px] text-slate-500 font-semibold" style={{ width: 48, height: 36 }}>
                #
              </div>
              {colsMeta.map(col => (
                <div
                  key={col.name}
                  className="flex items-center gap-1.5 px-3 text-xs font-semibold text-slate-300 border-r border-slate-700"
                  style={{ width: COL_WIDTH, minWidth: COL_WIDTH, flexShrink: 0, height: 36 }}
                >
                  <TypeBadge type={col.type} />
                  <span className="truncate">{col.name}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Scroll area */}
          <div
            ref={outerRef}
            onScroll={onScroll}
            className="flex-1 overflow-auto custom-scroll min-h-0"
          >
            <div style={{ height: filteredRows.length * ROW_HEIGHT, width: totalWidth, position: 'relative' }}>
              <div
                ref={bodyRef}
                style={{ position: 'absolute', top: 0, left: 0, width: '100%', willChange: 'transform' }}
              />
            </div>
          </div>
        </div>

        {/* ── Empty state ── */}
        {filteredRows.length === 0 && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <div className="text-center text-slate-500">
              <div className="text-4xl mb-2">🔍</div>
              <p className="text-sm">Ничего не найдено</p>
              <p className="text-xs text-slate-600 mt-1">Попробуйте изменить условие поиска</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
