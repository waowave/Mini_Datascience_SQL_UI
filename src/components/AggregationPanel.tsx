/**
 * AggregationPanel — визуальный конструктор GROUP BY.
 * Drag & drop колонок в зоны "Группировать по" и "Что посчитать".
 * Понятно даже бабушке-бухгалтеру.
 */
import { useState } from 'react';
import { X, Sigma, GripVertical, Plus, Trash2, Info } from 'lucide-react';
import type { AggFunc } from '../types';

interface AggEntry {
  col: string;
  func: AggFunc;
  alias: string;
}

interface Props {
  columns: string[];
  numericCols: string[];
  initialGroups?: string[];
  initialAggs?: AggEntry[];
  onConfirm: (groups: string[], aggs: AggEntry[]) => void;
  onClose: () => void;
  grandmaMode?: boolean;
}

const AGG_OPTIONS: { value: AggFunc; label: string; grandmaLabel: string; color: string }[] = [
  { value: 'SUM',            label: 'SUM',            grandmaLabel: '∑ Сумма',          color: 'text-green-400' },
  { value: 'AVG',            label: 'AVG',            grandmaLabel: '⌀ Среднее',         color: 'text-blue-400'  },
  { value: 'COUNT',          label: 'COUNT',          grandmaLabel: '# Количество строк', color: 'text-amber-400' },
  { value: 'COUNT DISTINCT', label: 'COUNT DISTINCT', grandmaLabel: '≠ Уникальных',      color: 'text-purple-400'},
  { value: 'MIN',            label: 'MIN',            grandmaLabel: '↓ Минимум',          color: 'text-cyan-400'  },
  { value: 'MAX',            label: 'MAX',            grandmaLabel: '↑ Максимум',          color: 'text-rose-400'  },
];

function AggFuncSelect({ value, onChange, grandmaMode }: { value: AggFunc; onChange: (v: AggFunc) => void; grandmaMode?: boolean }) {
  return (
    <select
      className="bg-slate-700 border border-slate-600 rounded-lg px-2 py-1 text-xs text-slate-200 outline-none focus:border-blue-500"
      value={value}
      onChange={e => onChange(e.target.value as AggFunc)}
    >
      {AGG_OPTIONS.map(o => (
        <option key={o.value} value={o.value}>
          {grandmaMode ? o.grandmaLabel : o.value}
        </option>
      ))}
    </select>
  );
}

export function AggregationPanel({
  columns, numericCols,
  initialGroups = [], initialAggs = [],
  onConfirm, onClose, grandmaMode = false,
}: Props) {
  const [groups, setGroups] = useState<string[]>(initialGroups);
  const [aggs, setAggs] = useState<AggEntry[]>(
    initialAggs.length > 0
      ? initialAggs
      : []
  );
  const [dragOver, setDragOver] = useState<'groups' | 'aggs' | null>(null);

  const addGroup = (col: string) => {
    if (!groups.includes(col)) setGroups(prev => [...prev, col]);
  };
  const removeGroup = (col: string) => setGroups(prev => prev.filter(c => c !== col));

  const addAgg = (col: string) => {
    const func: AggFunc = numericCols.includes(col) ? 'SUM' : 'COUNT';
    const alias = `${func}_${col}`;
    setAggs(prev => [...prev, { col, func, alias }]);
  };
  const removeAgg = (idx: number) => setAggs(prev => prev.filter((_, i) => i !== idx));
  const updateAgg = (idx: number, patch: Partial<AggEntry>) => {
    setAggs(prev => prev.map((a, i) => {
      if (i !== idx) return a;
      const updated = { ...a, ...patch };
      // auto-update alias if not manually changed
      if (patch.func || patch.col) {
        updated.alias = `${updated.func.replace(' ', '_')}_${updated.col}`;
      }
      return updated;
    }));
  };

  const availableForGroup = columns.filter(c => !groups.includes(c));
  const isValid = groups.length > 0 || aggs.length > 0;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm" onClick={onClose}>
      <div
        className="bg-slate-900 border border-slate-600 rounded-2xl shadow-2xl w-[700px] max-h-[90vh] flex flex-col overflow-hidden"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center gap-3 px-5 py-4 border-b border-slate-700 flex-shrink-0">
          <Sigma size={18} className="text-rose-400" />
          <div className="flex-1">
            <h2 className="text-sm font-semibold text-slate-200">
              {grandmaMode ? 'Сводка (Итого)' : 'Агрегация / GROUP BY'}
            </h2>
            <p className="text-xs text-slate-500">
              {grandmaMode
                ? 'Выберите по каким колонкам разбить и что посчитать'
                : 'Настройте группировку и агрегатные функции'}
            </p>
          </div>
          <button onClick={onClose} className="text-slate-500 hover:text-slate-200 transition-colors">
            <X size={16} />
          </button>
        </div>

        <div className="flex flex-1 min-h-0 overflow-hidden">
          {/* Left: available columns */}
          <div className="w-44 border-r border-slate-700 flex flex-col flex-shrink-0">
            <div className="px-3 py-2 text-[11px] font-semibold text-slate-400 border-b border-slate-700 uppercase tracking-wider">
              Колонки
            </div>
            <div className="flex-1 overflow-y-auto custom-scroll p-2 flex flex-col gap-1">
              {columns.map(col => (
                <div
                  key={col}
                  className="group flex items-center gap-1.5 px-2 py-1.5 bg-slate-800 hover:bg-slate-700 rounded-lg cursor-grab text-xs text-slate-200 transition-colors"
                  draggable
                  onDragStart={e => e.dataTransfer.setData('col', col)}
                >
                  <GripVertical size={10} className="text-slate-600 group-hover:text-slate-400 flex-shrink-0" />
                  <span className="flex-1 truncate">{col}</span>
                  {numericCols.includes(col) && (
                    <span className="text-[9px] text-blue-400 font-mono">123</span>
                  )}
                </div>
              ))}
            </div>
          </div>

          {/* Center: builder */}
          <div className="flex-1 flex flex-col gap-0 overflow-y-auto custom-scroll">
            {/* Groups zone */}
            <div className="flex-1 p-4 border-b border-slate-700/50">
              <div className="flex items-center gap-2 mb-3">
                <div className="w-6 h-6 rounded-lg bg-blue-500/20 flex items-center justify-center flex-shrink-0">
                  <span className="text-blue-400 text-[11px] font-bold">≡</span>
                </div>
                <div>
                  <p className="text-xs font-semibold text-slate-200">
                    {grandmaMode ? 'Разбить строки по...' : 'GROUP BY (Группировать по)'}
                  </p>
                  <p className="text-[10px] text-slate-500">
                    {grandmaMode
                      ? 'Каждое уникальное значение станет отдельной строкой в итоге'
                      : 'Уникальные комбинации этих колонок образуют строки результата'}
                  </p>
                </div>
              </div>

              {/* Drop zone */}
              <div
                className={`min-h-[80px] border-2 border-dashed rounded-xl p-2 flex flex-wrap gap-2 items-start content-start transition-colors ${
                  dragOver === 'groups'
                    ? 'border-blue-500 bg-blue-500/10'
                    : 'border-slate-700 hover:border-slate-500'
                }`}
                onDragOver={e => { e.preventDefault(); setDragOver('groups'); }}
                onDragLeave={() => setDragOver(null)}
                onDrop={e => {
                  e.preventDefault();
                  const col = e.dataTransfer.getData('col');
                  if (col) addGroup(col);
                  setDragOver(null);
                }}
              >
                {groups.length === 0 && (
                  <div className="w-full flex items-center justify-center text-[11px] text-slate-600 gap-1.5 py-2">
                    <span>Перетащите колонку сюда или</span>
                  </div>
                )}
                {groups.map(g => (
                  <span
                    key={g}
                    className="flex items-center gap-1.5 px-2.5 py-1 bg-blue-600/20 border border-blue-500/40 text-blue-300 rounded-lg text-xs font-medium"
                  >
                    {g}
                    <button onClick={() => removeGroup(g)} className="hover:text-red-400 transition-colors">
                      <X size={10} />
                    </button>
                  </span>
                ))}
                {availableForGroup.length > 0 && (
                  <div className="flex flex-wrap gap-1 mt-1 w-full">
                    {availableForGroup.slice(0, 6).map(col => (
                      <button
                        key={col}
                        onClick={() => addGroup(col)}
                        className="px-2 py-0.5 text-[10px] text-slate-500 hover:text-blue-300 border border-slate-700 hover:border-blue-500/40 rounded-md transition-colors"
                      >
                        + {col}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {/* Aggs zone */}
            <div className="flex-1 p-4">
              <div className="flex items-center gap-2 mb-3">
                <div className="w-6 h-6 rounded-lg bg-rose-500/20 flex items-center justify-center flex-shrink-0">
                  <Sigma size={12} className="text-rose-400" />
                </div>
                <div>
                  <p className="text-xs font-semibold text-slate-200">
                    {grandmaMode ? 'Что посчитать?' : 'Агрегатные функции'}
                  </p>
                  <p className="text-[10px] text-slate-500">
                    {grandmaMode
                      ? 'Для каждой группы будет вычислено это значение'
                      : 'Применяются к каждой группе строк'}
                  </p>
                </div>
              </div>

              <div
                className={`min-h-[80px] border-2 border-dashed rounded-xl p-2 flex flex-col gap-2 transition-colors ${
                  dragOver === 'aggs'
                    ? 'border-rose-500 bg-rose-500/10'
                    : 'border-slate-700 hover:border-slate-500'
                }`}
                onDragOver={e => { e.preventDefault(); setDragOver('aggs'); }}
                onDragLeave={() => setDragOver(null)}
                onDrop={e => {
                  e.preventDefault();
                  const col = e.dataTransfer.getData('col');
                  if (col) addAgg(col);
                  setDragOver(null);
                }}
              >
                {aggs.length === 0 && (
                  <div className="w-full flex items-center justify-center text-[11px] text-slate-600 gap-1.5 py-3">
                    Перетащите числовую колонку сюда
                  </div>
                )}

                {aggs.map((agg, idx) => (
                  <div key={idx} className="flex items-center gap-2 bg-slate-800 border border-slate-700 rounded-xl px-3 py-2">
                    <AggFuncSelect
                      value={agg.func}
                      onChange={func => updateAgg(idx, { func })}
                      grandmaMode={grandmaMode}
                    />
                    <span className="text-xs text-slate-500">→</span>
                    <select
                      className="flex-1 bg-slate-700 border border-slate-600 rounded-lg px-2 py-1 text-xs text-slate-200 outline-none focus:border-rose-500"
                      value={agg.col}
                      onChange={e => updateAgg(idx, { col: e.target.value })}
                    >
                      {columns.map(c => <option key={c} value={c}>{c}</option>)}
                    </select>
                    <span className="text-xs text-slate-600">как</span>
                    <input
                      className="w-28 bg-slate-700 border border-slate-600 rounded-lg px-2 py-1 text-xs text-slate-200 outline-none focus:border-rose-500 font-mono"
                      value={agg.alias}
                      onChange={e => updateAgg(idx, { alias: e.target.value })}
                      placeholder="Название"
                    />
                    <button onClick={() => removeAgg(idx)} className="text-slate-600 hover:text-red-400 transition-colors">
                      <Trash2 size={12} />
                    </button>
                  </div>
                ))}

                {/* Quick add */}
                <div className="flex flex-wrap gap-1">
                  {numericCols.slice(0, 5).map(col => (
                    <button
                      key={col}
                      onClick={() => addAgg(col)}
                      className="flex items-center gap-1 px-2 py-0.5 text-[10px] text-slate-500 hover:text-rose-300 border border-slate-700 hover:border-rose-500/40 rounded-md transition-colors"
                    >
                      <Plus size={8} /> Σ {col}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </div>

          {/* Right: explanation */}
          <div className="w-48 border-l border-slate-700 flex flex-col flex-shrink-0 p-3">
            <div className="flex items-center gap-1.5 mb-3">
              <Info size={12} className="text-blue-400" />
              <span className="text-[11px] font-semibold text-slate-400">Объяснение</span>
            </div>

            {groups.length > 0 || aggs.length > 0 ? (
              <div className="text-[11px] text-slate-400 leading-relaxed space-y-3">
                {groups.length > 0 && (
                  <div>
                    <p className="text-slate-300 font-medium mb-1">Разбивка:</p>
                    <p>
                      Строки сгруппируются по <span className="text-blue-300">{groups.join(', ')}</span>.
                      Каждая уникальная комбинация — одна итоговая строка.
                    </p>
                  </div>
                )}
                {aggs.length > 0 && (
                  <div>
                    <p className="text-slate-300 font-medium mb-1">Расчёты:</p>
                    {aggs.map((a, i) => (
                      <p key={i} className="mb-1">
                        • <span className="text-rose-300">{a.func}</span> колонки <span className="text-slate-200">{a.col}</span> → <span className="text-slate-400 font-mono text-[10px]">{a.alias}</span>
                      </p>
                    ))}
                  </div>
                )}
                {groups.length === 0 && aggs.length > 0 && (
                  <div className="p-2 bg-amber-500/10 border border-amber-500/30 rounded-lg">
                    <p className="text-amber-400 text-[10px]">
                      ⚠ Без группировки — получите одну итоговую строку по всей таблице
                    </p>
                  </div>
                )}
              </div>
            ) : (
              <p className="text-[11px] text-slate-600">
                Добавьте колонки чтобы увидеть объяснение...
              </p>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-5 py-3 border-t border-slate-700 flex-shrink-0">
          <div className="text-[11px] text-slate-500">
            {groups.length > 0 && `Групп: ${groups.length}`}
            {groups.length > 0 && aggs.length > 0 && ' · '}
            {aggs.length > 0 && `Функций: ${aggs.length}`}
          </div>
          <div className="flex gap-2">
            <button
              onClick={onClose}
              className="px-4 py-2 text-sm text-slate-400 hover:text-slate-200 transition-colors"
            >
              Отмена
            </button>
            <button
              disabled={!isValid}
              onClick={() => { if (isValid) { onConfirm(groups, aggs); onClose(); } }}
              className="px-5 py-2 text-sm font-semibold bg-rose-600 hover:bg-rose-500 disabled:bg-slate-700 disabled:text-slate-500 text-white rounded-xl transition-colors"
            >
              {grandmaMode ? 'Сделать сводку' : 'Применить GROUP BY'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
