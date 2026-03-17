import { useRef, useState, useCallback, useMemo, useEffect, useLayoutEffect } from 'react';
import { useStore } from '../store/useStore';
import { ColumnStatsBar } from './ColumnStatsBar';
import { UnifiedTableToolbar, type SearchState } from './UnifiedTableToolbar';
import type { ColumnMeta, Step } from '../types';
import {
  ArrowUp, ArrowDown, Filter, Sigma, Pencil,
  EyeOff, Hash, Type, Calendar, X, Sparkles,
} from 'lucide-react';

interface ContextMenu { x: number; y: number; col: string; val?: unknown }

const MIN_COL_WIDTH = 60;
const DEF_COL_WIDTH = 160;
const ROW_HEIGHT    = 33;
const OVERSCAN      = 5;

function TypeIcon({ type }: { type: string }) {
  if (type === 'integer' || type === 'float') return <Hash size={10} className="text-blue-400" />;
  if (type === 'date') return <Calendar size={10} className="text-green-400" />;
  return <Type size={10} className="text-slate-400" />;
}

function typeLabel(type: string, grandma: boolean) {
  if (type === 'integer') return grandma ? 'Целое' : 'INT';
  if (type === 'float')   return grandma ? 'Число' : 'FLOAT';
  if (type === 'date')    return grandma ? 'Дата'  : 'DATE';
  return grandma ? 'Текст' : 'TEXT';
}

// ─── Build search matcher ─────────────────────────────────────────────────────
function buildMatcher(s: SearchState, cols: ColumnMeta[]) {
  if (!s.query.trim()) return null;
  const targets = s.cols.size > 0 ? cols.filter(c => s.cols.has(c.name)) : cols;
  if (s.useRegex) {
    try {
      const re = new RegExp(s.query, 'i');
      return (row: Record<string, unknown>) =>
        targets.some(c => re.test(String(row[c.name] ?? '')));
    } catch { return null; }
  }
  const q = s.query.toLowerCase();
  return (row: Record<string, unknown>) =>
    targets.some(c => String(row[c.name] ?? '').toLowerCase().includes(q));
}

// ─── Pure virtual grid — no React scroll state ────────────────────────────────
function VirtualGrid({
  rows, colsMeta, selectedCol, grandmaMode,
  colWidths, onResizeCol,
  onHeaderClick, onHeaderCtx, onHeaderDblClick, onCellCtx,
}: {
  rows: Record<string, unknown>[];
  colsMeta: ColumnMeta[];
  selectedCol: string | null;
  grandmaMode: boolean;
  colWidths: Record<string, number>;
  onResizeCol: (col: string, w: number) => void;
  onHeaderClick: (col: string) => void;
  onHeaderCtx: (e: React.MouseEvent, col: string) => void;
  onHeaderDblClick: (col: string) => void;
  onCellCtx: (e: React.MouseEvent, col: string, val: unknown) => void;
}) {
  const outerRef  = useRef<HTMLDivElement>(null);
  const headerRef = useRef<HTMLDivElement>(null);
  const bodyRef   = useRef<HTMLDivElement>(null);
  const rafRef    = useRef(0);
  const scrollRef = useRef({ top: 0, left: 0, h: 0 });

  // Resize state — stored in refs to avoid re-renders during drag
  const resizingRef = useRef<{ col: string; startX: number; startW: number } | null>(null);

  const getW = useCallback((col: string) => colWidths[col] ?? DEF_COL_WIDTH, [colWidths]);
  const totalWidth = colsMeta.reduce((s, c) => s + getW(c.name), 48);

  const renderRows = useCallback(() => {
    const body = bodyRef.current;
    if (!body) return;
    const { top, h } = scrollRef.current;
    const startIdx = Math.max(0, Math.floor(top / ROW_HEIGHT) - OVERSCAN);
    const visible  = Math.ceil(Math.max(h, 100) / ROW_HEIGHT) + OVERSCAN * 2;
    const endIdx   = Math.min(rows.length - 1, startIdx + visible);
    const offsetY  = startIdx * ROW_HEIGHT;
    body.style.transform = `translateY(${offsetY}px)`;

    let html = '';
    for (let i = startIdx; i <= endIdx; i++) {
      const row = rows[i];
      const even = i % 2 === 0;
      const bg = even ? 'background:rgba(15,23,42,0.3)' : 'background:rgb(2,6,23)';
      html += `<div class="flex hover-row" style="height:${ROW_HEIGHT}px;width:${totalWidth}px;${bg}" data-idx="${i}">`;
      html += `<div class="rn" style="width:48px;min-width:48px;flex-shrink:0;display:flex;align-items:center;padding:0 8px;border-right:1px solid rgba(51,65,85,0.4);border-bottom:1px solid rgba(51,65,85,0.3);font-size:10px;color:rgb(71,85,105);font-variant-numeric:tabular-nums">${i + 1}</div>`;
      for (let j = 0; j < colsMeta.length; j++) {
        const col = colsMeta[j];
        const val = row[col.name];
        const isNum = col.type === 'integer' || col.type === 'float';
        const isSelCol = selectedCol === col.name;
        const selBg = isSelCol ? 'background:rgba(59,130,246,0.07);' : '';
        const nullish = val === null || val === undefined;
        const textColor = nullish
          ? 'color:rgb(71,85,105);font-style:italic'
          : isNum
          ? 'color:rgb(147,197,253);font-variant-numeric:tabular-nums;text-align:right'
          : 'color:rgb(226,232,240)';
        const formatted = nullish ? '—' : isNum && typeof val === 'number'
          ? val.toLocaleString('ru-RU', { maximumFractionDigits: 2 })
          : String(val).replace(/</g, '&lt;');
        const w = getW(col.name);
        html += `<div class="cell" data-col="${col.name}" data-val="${String(val ?? '').replace(/"/g, '&quot;')}" style="width:${w}px;min-width:${w}px;flex-shrink:0;display:flex;align-items:center;padding:0 12px;border-right:1px solid rgba(51,65,85,0.3);border-bottom:1px solid rgba(51,65,85,0.3);height:${ROW_HEIGHT}px;cursor:context-menu;overflow:hidden;${selBg}">`;
        html += `<span style="font-size:12px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;width:100%;${textColor}">${formatted}</span>`;
        html += `</div>`;
      }
      html += `</div>`;
    }
    body.innerHTML = html;
  }, [rows, colsMeta, selectedCol, totalWidth, getW]);

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
    return () => ro.disconnect();
  }, [renderRows]);

  useEffect(() => {
    scrollRef.current.top = outerRef.current?.scrollTop ?? 0;
    renderRows();
    syncHeader();
  }, [rows, colsMeta, selectedCol, renderRows, syncHeader]);

  // Context menu via event delegation
  const handleBodyCtx = useCallback((e: MouseEvent) => {
    const cell = (e.target as HTMLElement).closest<HTMLElement>('.cell');
    if (!cell) return;
    e.preventDefault();
    const col = cell.dataset.col ?? '';
    const rawVal = cell.dataset.val;
    const val = rawVal === 'null' || rawVal === 'undefined' ? undefined : rawVal;
    onCellCtx(e as unknown as React.MouseEvent, col, val);
  }, [onCellCtx]);

  useEffect(() => {
    const body = bodyRef.current;
    if (!body) return;
    body.addEventListener('contextmenu', handleBodyCtx as EventListener);
    return () => body.removeEventListener('contextmenu', handleBodyCtx as EventListener);
  }, [handleBodyCtx]);

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* ── HEADER — outside scroll ── */}
      <div
        className="flex-shrink-0 overflow-hidden bg-slate-800 border-b border-slate-600 select-none"
        style={{ height: 38 }}
      >
        <div ref={headerRef} className="flex" style={{ width: totalWidth, minWidth: totalWidth }}>
          <div
            className="flex-shrink-0 flex items-center px-2 border-r border-slate-700 text-[10px] text-slate-500 font-semibold"
            style={{ width: 48, minWidth: 48, height: 38 }}
          >
            #
          </div>
          {colsMeta.map(col => {
            const isSelected = selectedCol === col.name;
            const w = getW(col.name);
            return (
              <div
                key={col.name}
                className="relative flex-shrink-0"
                style={{ width: w, minWidth: w, height: 38 }}
              >
                <div
                  className={`flex items-center gap-1.5 px-3 text-xs font-semibold border-r border-slate-700 cursor-pointer transition-colors group h-full ${
                    isSelected
                      ? 'bg-blue-600/30 text-blue-200 border-b-2 border-b-blue-500'
                      : 'text-slate-200 hover:bg-slate-700/70'
                  }`}
                  style={{ width: '100%' }}
                  onClick={() => onHeaderClick(col.name)}
                  onContextMenu={e => onHeaderCtx(e, col.name)}
                  onDoubleClick={() => onHeaderDblClick(col.name)}
                  title="Клик — статистика | ПКМ — меню | Двойной клик — переименовать"
                >
                  <TypeIcon type={col.type} />
                  <span className="truncate flex-1">{col.name}</span>
                  <span className="text-slate-600 text-[9px] group-hover:text-slate-400 transition-colors flex-shrink-0">
                    {typeLabel(col.type, grandmaMode)}
                  </span>
                </div>
                {/* Resize handle */}
                <div
                  className="absolute right-0 top-0 h-full w-2 cursor-col-resize z-10 hover:bg-blue-500/40 active:bg-blue-500/60 transition-colors"
                  style={{ touchAction: 'none' }}
                  onMouseDown={e => {
                    e.preventDefault();
                    e.stopPropagation();
                    resizingRef.current = { col: col.name, startX: e.clientX, startW: w };
                    const onMove = (mv: MouseEvent) => {
                      if (!resizingRef.current) return;
                      const delta = mv.clientX - resizingRef.current.startX;
                      const newW  = Math.max(MIN_COL_WIDTH, resizingRef.current.startW + delta);
                      onResizeCol(resizingRef.current.col, newW);
                    };
                    const onUp = () => {
                      resizingRef.current = null;
                      window.removeEventListener('mousemove', onMove);
                      window.removeEventListener('mouseup', onUp);
                    };
                    window.addEventListener('mousemove', onMove);
                    window.addEventListener('mouseup', onUp);
                  }}
                />
              </div>
            );
          })}
        </div>
      </div>

      {/* ── SCROLL CONTAINER ── */}
      <div
        ref={outerRef}
        onScroll={onScroll}
        className="flex-1 overflow-auto custom-scroll min-h-0"
      >
        <div style={{ height: rows.length * ROW_HEIGHT, width: totalWidth, position: 'relative' }}>
          <div
            ref={bodyRef}
            style={{ position: 'absolute', top: 0, left: 0, width: '100%', willChange: 'transform' }}
          />
        </div>
      </div>
    </div>
  );
}

// ─── Main DataGrid ────────────────────────────────────────────────────────────
export function DataGrid() {
  const {
    queryResult, isExecuting,
    quickFilter, quickSort, quickRename,
    grandmaMode, addStep, activeTabId, executeActive,
    setPendingEditStep,
  } = useStore();

  const [contextMenu,  setContextMenu]  = useState<ContextMenu | null>(null);
  const [renameDialog, setRenameDialog] = useState<{ col: string } | null>(null);
  const [renameTo,     setRenameTo]     = useState('');
  const [selectedCol,  setSelectedCol]  = useState<string | null>(null);
  const [hiddenCols,   setHiddenCols]   = useState<Set<string>>(new Set());
  const [search,       setSearch]       = useState<SearchState>({ query: '', useRegex: false, cols: new Set() });
  const [colWidths,    setColWidths]    = useState<Record<string, number>>({});

  const handleResizeCol = useCallback((col: string, w: number) => {
    setColWidths(prev => ({ ...prev, [col]: w }));
  }, []);

  const allRows  = useMemo(() => queryResult?.rows    ?? [], [queryResult]);
  const allCols  = useMemo(() => queryResult?.columns ?? [], [queryResult]) as ColumnMeta[];
  const colsMeta = useMemo(() => allCols.filter(c => !hiddenCols.has(c.name)), [allCols, hiddenCols]);
  const numericCols = useMemo(() => allCols.filter(c => c.type === 'integer' || c.type === 'float').map(c => c.name), [allCols]);

  // Apply search filter to rows
  const matcher = useMemo(() => buildMatcher(search, allCols), [search, allCols]);
  const rows = useMemo(() => matcher ? allRows.filter(matcher) : allRows, [matcher, allRows]);

  // Close context menu on outside click
  useEffect(() => {
    const close = () => setContextMenu(null);
    document.addEventListener('click', close);
    return () => document.removeEventListener('click', close);
  }, []);

  const handleHeaderClick    = useCallback((col: string) => setSelectedCol(prev => prev === col ? null : col), []);
  const handleHeaderCtx      = useCallback((e: React.MouseEvent, col: string) => { e.preventDefault(); e.stopPropagation(); setContextMenu({ x: e.clientX, y: e.clientY, col }); }, []);
  const handleHeaderDblClick = useCallback((col: string) => { setRenameTo(col); setRenameDialog({ col }); }, []);
  const handleCellCtx        = useCallback((e: React.MouseEvent, col: string, val: unknown) => { e.preventDefault(); e.stopPropagation(); setContextMenu({ x: e.clientX, y: e.clientY, col, val }); }, []);

  const selectedColMeta = selectedCol ? allCols.find(c => c.name === selectedCol) : null;

  // Добавить шаг и сразу открыть редактор
  const addStepAndEdit = useCallback((stepDef: Omit<Step, 'id'>) => {
    const newId = addStep(activeTabId, stepDef);
    setPendingEditStep(newId);
  }, [addStep, activeTabId, setPendingEditStep]);

  // ── Loading / empty states ─────────────────────────────────────────────────
  if (isExecuting) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-slate-500 select-none">
        <div className="w-8 h-8 border-2 border-blue-500 border-t-transparent rounded-full animate-spin mb-3" />
        <p className="text-sm">Выполнение запроса...</p>
      </div>
    );
  }

  if (!queryResult) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-slate-500 select-none gap-3">
        <div className="text-5xl">⚡</div>
        <p className="text-base font-semibold text-slate-400">
          {grandmaMode ? 'Нажмите «Показать результат»' : 'Нажмите «Выполнить»'}
        </p>
        <p className="text-xs text-slate-600 text-center max-w-xs">
          Добавьте шаги в пайплайн и запустите выполнение
        </p>
      </div>
    );
  }

  if (queryResult.error) {
    return (
      <div className="flex flex-col items-center justify-center h-full select-none gap-2 p-8">
        <div className="text-4xl">⚠️</div>
        <p className="text-sm text-red-400 font-semibold">Ошибка выполнения</p>
        <p className="text-xs text-slate-500 text-center font-mono bg-slate-800 rounded p-3 max-w-lg">{queryResult.error}</p>
      </div>
    );
  }

  if (allRows.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-slate-500 select-none gap-2">
        <div className="text-4xl">🔍</div>
        <p className="text-sm">Нет данных по текущим условиям</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full relative bg-slate-950">

      {/* ── Unified toolbar ── */}
      <UnifiedTableToolbar
        columns={allCols.map(c => c.name)}
        onSearchChange={setSearch}
        rowCount={rows.length}
        totalCount={allRows.length}
        exportData={queryResult ? {
          rows,
          columns: allCols.map(c => c.name),
          filename: 'результат',
        } : undefined}
        extra={
          <>
            {hiddenCols.size > 0 && (
              <button
                className="flex items-center gap-1 text-[11px] text-amber-400 hover:text-amber-200 transition-colors px-2 py-1 rounded-lg hover:bg-amber-500/10"
                onClick={() => setHiddenCols(new Set())}
              >
                <EyeOff size={11} /> {hiddenCols.size} скрыто
              </button>
            )}
            {queryResult.executionTime !== undefined && (
              <span className="text-[10px] text-green-500/80 tabular-nums">
                {queryResult.executionTime.toFixed(1)}ms
              </span>
            )}
            <button
              onClick={() => addStepAndEdit({ type: 'FORMULA', params: { formula: { newCol: 'Новая_колонка', expr: '' } }, uiMeta: { isCollapsed: false, comment: '', isActive: true } })}
              className="flex items-center gap-1.5 px-2 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 hover:border-slate-500 transition-all text-left group"
              title="Добавить вычисляемую колонку"
            >
              <Sparkles size={11} className="text-green-400" />
              <span className="text-[11px] text-slate-300 group-hover:text-slate-100">
                {grandmaMode ? 'Новая колонка' : 'Формула'}
              </span>
            </button>
            <button
              onClick={() => addStepAndEdit({ type: 'GROUP', params: { aggregate: { groups: [], aggs: [] } }, uiMeta: { isCollapsed: false, comment: '', isActive: true } })}
              className="flex items-center gap-1.5 px-2 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 hover:border-slate-500 transition-all text-left group"
              title="Группировка и агрегация"
            >
              <Sigma size={11} className="text-rose-400" />
              <span className="text-[11px] text-slate-300 group-hover:text-slate-100">
                {grandmaMode ? 'Сводка (Итого)' : 'GROUP BY'}
              </span>
            </button>
          </>
        }
      />

      {/* ── Virtual grid ── */}
      <div className="flex-1 min-h-0 overflow-hidden">
        <VirtualGrid
          rows={rows}
          colsMeta={colsMeta}
          selectedCol={selectedCol}
          grandmaMode={grandmaMode}
          colWidths={colWidths}
          onResizeCol={handleResizeCol}
          onHeaderClick={handleHeaderClick}
          onHeaderCtx={handleHeaderCtx}
          onHeaderDblClick={handleHeaderDblClick}
          onCellCtx={handleCellCtx}
        />
      </div>

      {/* ── Column stats bar ── */}
      {selectedCol && selectedColMeta && (
        <ColumnStatsBar
          colName={selectedCol}
          colMeta={selectedColMeta}
          rows={rows}
          totalRows={queryResult.totalRows}
          grandmaMode={grandmaMode}
          onClose={() => setSelectedCol(null)}
          onAddFormula={() => { addStepAndEdit({ type: 'FORMULA', params: { formula: { newCol: `${selectedCol}_расчёт`, expr: `[${selectedCol}]` } }, uiMeta: { isCollapsed: false, comment: '', isActive: true } }); setSelectedCol(null); }}
          onAddFilter={() => { quickFilter(selectedCol, ''); setSelectedCol(null); }}
          onAddGroup={() => { addStepAndEdit({ type: 'GROUP', params: { aggregate: { groups: [selectedCol], aggs: [] } }, uiMeta: { isCollapsed: false, comment: '', isActive: true } }); setSelectedCol(null); }}
        />
      )}

      {/* ── Context Menu ── */}
      {contextMenu && (
        <div
          className="fixed z-50 bg-slate-800 border border-slate-600 rounded-xl shadow-2xl py-1 min-w-[210px]"
          style={{ left: contextMenu.x, top: contextMenu.y }}
          onClick={e => e.stopPropagation()}
        >
          <div className="px-3 py-1.5 text-[10px] text-slate-500 font-semibold uppercase tracking-wider border-b border-slate-700 mb-1">
            {contextMenu.col}
          </div>

          {contextMenu.val !== undefined && (
            <button
              className="w-full flex items-center gap-2.5 px-3 py-2 text-xs text-slate-300 hover:bg-slate-700 hover:text-white transition-colors"
              onClick={() => { quickFilter(contextMenu.col, contextMenu.val); setContextMenu(null); executeActive(); }}
            >
              <Filter size={12} className="text-amber-400" />
              {grandmaMode ? `Оставить только «${String(contextMenu.val ?? '').slice(0, 20)}»` : 'Фильтр по значению'}
            </button>
          )}

          <button className="w-full flex items-center gap-2.5 px-3 py-2 text-xs text-slate-300 hover:bg-slate-700 hover:text-white transition-colors"
            onClick={() => { quickSort(contextMenu.col, 'ASC'); setContextMenu(null); executeActive(); }}>
            <ArrowUp size={12} className="text-cyan-400" />
            {grandmaMode ? 'По возрастанию ↑' : 'Сортировать ASC'}
          </button>
          <button className="w-full flex items-center gap-2.5 px-3 py-2 text-xs text-slate-300 hover:bg-slate-700 hover:text-white transition-colors"
            onClick={() => { quickSort(contextMenu.col, 'DESC'); setContextMenu(null); executeActive(); }}>
            <ArrowDown size={12} className="text-cyan-400" />
            {grandmaMode ? 'По убыванию ↓' : 'Сортировать DESC'}
          </button>

          <div className="border-t border-slate-700/60 my-1" />

          <button className="w-full flex items-center gap-2.5 px-3 py-2 text-xs text-slate-300 hover:bg-slate-700 hover:text-white transition-colors"
            onClick={() => { addStepAndEdit({ type: 'FORMULA', params: { formula: { newCol: `${contextMenu.col}_расчёт`, expr: `[${contextMenu.col}]` } }, uiMeta: { isCollapsed: false, comment: '', isActive: true } }); setContextMenu(null); }}>
            <Sparkles size={12} className="text-green-400" />
            {grandmaMode ? 'Создать формулу' : 'Формула на основе'}
          </button>

          <button className="w-full flex items-center gap-2.5 px-3 py-2 text-xs text-slate-300 hover:bg-slate-700 hover:text-white transition-colors"
            onClick={() => {
              const groups = [contextMenu.col];
              const aggs = numericCols.filter(c => c !== contextMenu.col).slice(0, 2)
                .map(c => ({ col: c, func: 'SUM' as const, alias: `SUM_${c}` }));
              addStep(activeTabId, {
                type: 'GROUP',
                params: { aggregate: { groups, aggs } },
                uiMeta: { isCollapsed: false, comment: '', isActive: true },
              });
              setContextMenu(null);
              executeActive();
            }}>
            <Sigma size={12} className="text-rose-400" />
            {grandmaMode ? 'Сводка по этой колонке' : 'GROUP BY + SUM'}
          </button>

          {/* ── Quick aggregations (numeric only) ── */}
          {(allCols.find(c => c.name === contextMenu.col)?.type === 'integer' ||
            allCols.find(c => c.name === contextMenu.col)?.type === 'float') && (
            <>
              <div className="border-t border-slate-700/60 mt-1 mb-0.5" />
              <div className="px-3 py-1 text-[10px] text-slate-500 font-semibold uppercase tracking-wider">
                Быстрый итог
              </div>
              {(['SUM', 'AVG', 'MIN', 'MAX', 'COUNT'] as const).map(func => (
                <button
                  key={func}
                  className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-slate-300 hover:bg-slate-700 hover:text-white transition-colors"
                  onClick={() => {
                    addStep(activeTabId, {
                      type: 'GROUP',
                      params: { aggregate: {
                        groups: [],
                        aggs: [{ col: contextMenu.col, func, alias: `${func}_${contextMenu.col}` }],
                      }},
                      uiMeta: { isCollapsed: false, comment: `${func} по "${contextMenu.col}"`, isActive: true },
                    });
                    setContextMenu(null);
                    executeActive();
                  }}
                >
                  <span className="font-mono text-[11px] text-rose-300 w-10 flex-shrink-0 text-left">{func}</span>
                  <span className="text-slate-500 text-[11px] truncate">{contextMenu.col}</span>
                </button>
              ))}
            </>
          )}

          <div className="border-t border-slate-700/60 my-1" />

          <button className="w-full flex items-center gap-2.5 px-3 py-2 text-xs text-slate-300 hover:bg-slate-700 hover:text-white transition-colors"
            onClick={() => { setRenameTo(contextMenu.col); setRenameDialog({ col: contextMenu.col }); setContextMenu(null); }}>
            <Pencil size={12} className="text-orange-400" />
            {grandmaMode ? 'Переименовать' : 'Rename column'}
          </button>
          <button className="w-full flex items-center gap-2.5 px-3 py-2 text-xs text-slate-300 hover:bg-slate-700 hover:text-white transition-colors"
            onClick={() => { setHiddenCols(prev => new Set(prev).add(contextMenu.col)); setContextMenu(null); }}>
            <EyeOff size={12} className="text-slate-400" />
            {grandmaMode ? 'Скрыть колонку' : 'Hide column'}
          </button>
        </div>
      )}

      {/* ── Rename Dialog ── */}
      {renameDialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="bg-slate-800 border border-slate-600 rounded-2xl p-6 shadow-2xl w-80">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-semibold text-slate-200">
                {grandmaMode ? 'Переименовать колонку' : 'Rename column'}
              </h3>
              <button onClick={() => setRenameDialog(null)} className="text-slate-400 hover:text-slate-200"><X size={16} /></button>
            </div>
            <p className="text-xs text-slate-500 mb-3">
              Было: <span className="text-slate-300 font-mono">{renameDialog.col}</span>
            </p>
            <input
              autoFocus
              className="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-sm text-slate-200 outline-none focus:border-blue-500 mb-4"
              value={renameTo}
              onChange={e => setRenameTo(e.target.value)}
              placeholder="Новое название..."
              onKeyDown={e => {
                if (e.key === 'Enter' && renameTo.trim() && renameTo !== renameDialog.col) {
                  quickRename(renameDialog.col, renameTo.trim()); setRenameDialog(null); executeActive();
                }
                if (e.key === 'Escape') setRenameDialog(null);
              }}
            />
            <div className="flex gap-2 justify-end">
              <button className="px-3 py-1.5 text-xs text-slate-400 hover:text-slate-200 transition-colors" onClick={() => setRenameDialog(null)}>Отмена</button>
              <button
                className="px-4 py-1.5 text-xs bg-blue-600 hover:bg-blue-500 text-white rounded-lg transition-colors"
                onClick={() => { if (renameTo.trim() && renameTo !== renameDialog.col) { quickRename(renameDialog.col, renameTo.trim()); setRenameDialog(null); executeActive(); } }}
              >
                Переименовать
              </button>
            </div>
          </div>
        </div>
      )}


    </div>
  );
}
