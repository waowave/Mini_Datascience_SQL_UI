/**
 * FormulaBuilder — полноценный редактор формул с автодополнением,
 * справочником функций и live-превью на первых строках данных.
 */
import { useState, useRef, useEffect, useCallback } from 'react';
import { X, Sparkles, ChevronDown, ChevronRight, Info, CheckCircle2, AlertCircle } from 'lucide-react';
import { useStore } from '../store/useStore';

interface Props {
  /** Если передан — режим редактирования существующего шага */
  initialCol?: string;
  initialExpr?: string;
  /** Колонки доступные на этом этапе пайплайна (вычисляются снаружи через SchemaInference) */
  availableColumns?: string[];
  onConfirm: (newCol: string, expr: string) => void;
  onClose: () => void;
}

// ─── Справочник функций ───────────────────────────────────────────
const FUNC_GROUPS = [
  {
    label: 'Математика',
    color: 'text-blue-400',
    funcs: [
      { name: 'ОКРУГЛ(значение, знаки)', desc: 'Округлить число', example: 'ОКРУГЛ([Цена], 2)' },
      { name: 'ABS(значение)', desc: 'Модуль числа', example: 'ABS([Прибыль])' },
      { name: 'SQRT(значение)', desc: 'Квадратный корень', example: 'SQRT([Площадь])' },
      { name: 'МАКС(a, b)', desc: 'Максимум из двух', example: 'МАКС([Цена], 0)' },
      { name: 'МИН(a, b)', desc: 'Минимум из двух', example: 'МИН([Скидка], 100)' },
    ],
  },
  {
    label: 'Арифметика',
    color: 'text-green-400',
    funcs: [
      { name: '[Колонка1] + [Колонка2]', desc: 'Сложение', example: '[Цена] + [НДС]' },
      { name: '[Колонка1] - [Колонка2]', desc: 'Вычитание', example: '[Цена] - [Скидка]' },
      { name: '[Колонка1] * [Колонка2]', desc: 'Умножение', example: '[Цена] * [Количество]' },
      { name: '[Колонка1] / [Колонка2]', desc: 'Деление', example: '[Выручка] / [Количество]' },
      { name: '([A] + [B]) * [C]', desc: 'Скобки для порядка', example: '([Цена] + [НДС]) * [Количество]' },
    ],
  },
  {
    label: 'Полезные расчёты',
    color: 'text-amber-400',
    funcs: [
      { name: '[Цена] * [Количество]', desc: 'Сумма продажи', example: '[Цена] * [Количество]' },
      { name: '[Цена] * (1 - [Скидка] / 100)', desc: 'Цена со скидкой', example: '[Цена] * (1 - [Скидка] / 100)' },
      { name: 'ОКРУГЛ([Цена] * 1.2, 2)', desc: 'Цена + 20% (НДС)', example: 'ОКРУГЛ([Цена] * 1.2, 2)' },
      { name: '([A] - [B]) / [B] * 100', desc: 'Прирост в %', example: '([Факт] - [План]) / [План] * 100' },
    ],
  },
];

// ─── Eval одной строки для превью ────────────────────────────────
function evalPreview(expr: string, row: Record<string, any>): string {
  try {
    let code = expr.replace(/\[([^\]]+)\]/g, (_, col) => {
      const v = row[col];
      if (v === null || v === undefined) return '0';
      if (typeof v === 'string') return JSON.stringify(v);
      return String(v);
    });
    code = code
      .replace(/ОКРУГЛ\s*\(([^,]+),\s*(\d+)\)/gi, 'Math.round(($1)*Math.pow(10,$2))/Math.pow(10,$2)')
      .replace(/ABS\s*\(/gi, 'Math.abs(')
      .replace(/SQRT\s*\(/gi, 'Math.sqrt(')
      .replace(/МАКС\s*\(/gi, 'Math.max(')
      .replace(/МИН\s*\(/gi, 'Math.min(');
    // eslint-disable-next-line no-new-func
    const result = new Function('Math', 'return ' + code)(Math);
    if (result === null || result === undefined) return '—';
    if (typeof result === 'number') return result.toLocaleString('ru-RU', { maximumFractionDigits: 4 });
    return String(result);
  } catch {
    return '⚠ ошибка';
  }
}

function hasError(expr: string, row: Record<string, any>): boolean {
  const result = evalPreview(expr, row);
  return result === '⚠ ошибка';
}

export function FormulaBuilder({ initialCol = 'Новая_колонка', initialExpr = '', availableColumns, onConfirm, onClose }: Props) {
  const { sources, pipelines, activeTabId, queryResult } = useStore();

  // ✅ Если переданы колонки снаружи — используем их (актуальная схема на данном шаге).
  // Иначе fallback на queryResult или FROM-источник.
  const pipeline = pipelines.find(p => p.id === activeTabId);
  const fromStep = pipeline?.steps.find(s => s.type === 'FROM');
  const source = sources.find(s => s.id === fromStep?.params?.tableId);

  const availableCols: string[] = availableColumns
    ?? queryResult?.columns.map(c => c.name)
    ?? source?.columns.map(c => c.name)
    ?? [];

  // Preview rows (first 3 from result or source)
  const previewRows: Record<string, any>[] = queryResult?.rows.slice(0, 3)
    ?? source?.rows.slice(0, 3)
    ?? [];

  const [colName, setColName] = useState(initialCol);
  const [expr, setExpr] = useState(initialExpr);
  const [showFuncs, setShowFuncs] = useState(false);
  const [expandedGroup, setExpandedGroup] = useState<string | null>('Полезные расчёты');

  // Autocomplete
  const [acOpen, setAcOpen] = useState(false);
  const [acQuery, setAcQuery] = useState('');
  const [acPos, setAcPos] = useState(0);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const filteredCols = availableCols.filter(c =>
    c.toLowerCase().includes(acQuery.toLowerCase())
  );

  const handleExprChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const val = e.target.value;
    const pos = e.target.selectionStart ?? 0;
    setExpr(val);
    setAcPos(pos);

    // Detect [ trigger
    const before = val.slice(0, pos);
    const match = before.match(/\[([^\]]*)$/);
    if (match) {
      setAcQuery(match[1]);
      setAcOpen(true);
    } else {
      setAcOpen(false);
    }
  }, []);

  const insertCol = useCallback((col: string) => {
    if (!textareaRef.current) return;
    const val = expr;
    const pos = acPos;
    const before = val.slice(0, pos);
    const after = val.slice(pos);
    // Replace from last [ to cursor
    const matchStart = before.lastIndexOf('[');
    const newVal = val.slice(0, matchStart) + `[${col}]` + after;
    setExpr(newVal);
    setAcOpen(false);
    textareaRef.current.focus();
  }, [expr, acPos]);

  const insertFunc = useCallback((example: string) => {
    setExpr(prev => prev ? prev + ' ' + example : example);
    textareaRef.current?.focus();
  }, []);

  // Validate: check on first preview row
  const isValid = expr.trim().length > 0 && colName.trim().length > 0;
  const previewError = previewRows.length > 0 && isValid && hasError(expr, previewRows[0]);

  // Close autocomplete on outside click
  useEffect(() => {
    const close = () => setAcOpen(false);
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, []);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm" onClick={onClose}>
      <div
        className="bg-slate-900 border border-slate-600 rounded-2xl shadow-2xl w-[680px] max-h-[90vh] flex flex-col overflow-hidden"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center gap-3 px-5 py-4 border-b border-slate-700 flex-shrink-0">
          <Sparkles size={18} className="text-green-400" />
          <div className="flex-1">
            <h2 className="text-sm font-semibold text-slate-200">Новая вычисляемая колонка</h2>
            <p className="text-xs text-slate-500">Используйте [Название колонки] для обращения к данным</p>
          </div>
          <button onClick={onClose} className="text-slate-500 hover:text-slate-200 transition-colors">
            <X size={16} />
          </button>
        </div>

        <div className="flex flex-1 min-h-0 overflow-hidden">
          {/* Left: editor */}
          <div className="flex-1 flex flex-col gap-4 p-5 overflow-y-auto custom-scroll">
            {/* Column name */}
            <div>
              <label className="text-xs text-slate-400 font-medium mb-1 block">
                Название новой колонки
              </label>
              <input
                className="w-full bg-slate-800 border border-slate-600 rounded-lg px-3 py-2 text-sm text-slate-200 outline-none focus:border-green-500 font-mono"
                value={colName}
                onChange={e => setColName(e.target.value.replace(/\s+/g, '_'))}
                placeholder="Итого_руб"
              />
              <p className="text-[10px] text-slate-600 mt-1">Пробелы заменяются на _</p>
            </div>

            {/* Formula input */}
            <div className="relative">
              <label className="text-xs text-slate-400 font-medium mb-1 block">
                Формула
              </label>
              <div className="relative">
                <div className="absolute top-2 left-3 text-slate-500 text-sm font-mono select-none">=</div>
                <textarea
                  ref={textareaRef}
                  className="w-full bg-slate-800 border border-slate-600 rounded-lg pl-7 pr-3 py-2 text-sm text-slate-200 outline-none focus:border-green-500 font-mono resize-none h-24"
                  value={expr}
                  onChange={handleExprChange}
                  onKeyDown={e => {
                    if (acOpen && e.key === 'Tab' && filteredCols.length > 0) {
                      e.preventDefault();
                      insertCol(filteredCols[0]);
                    }
                    if (acOpen && e.key === 'Escape') setAcOpen(false);
                  }}
                  placeholder="[Цена] * [Количество]"
                  spellCheck={false}
                />

                {/* Autocomplete dropdown */}
                {acOpen && filteredCols.length > 0 && (
                  <div className="absolute left-7 top-full mt-1 bg-slate-800 border border-slate-600 rounded-xl shadow-2xl z-50 max-h-40 overflow-y-auto min-w-[200px]">
                    {filteredCols.map(col => (
                      <button
                        key={col}
                        className="w-full text-left px-3 py-1.5 text-sm text-slate-200 hover:bg-blue-600/30 font-mono transition-colors"
                        onMouseDown={e => { e.preventDefault(); insertCol(col); }}
                      >
                        [{col}]
                      </button>
                    ))}
                    <div className="px-3 py-1 text-[10px] text-slate-600 border-t border-slate-700">
                      Tab — вставить первый
                    </div>
                  </div>
                )}
              </div>

              <div className="flex items-center gap-2 mt-1.5">
                <Info size={10} className="text-slate-600 flex-shrink-0" />
                <p className="text-[10px] text-slate-600">
                  Введите <span className="text-slate-400 font-mono">[</span> для автодополнения колонок
                </p>
              </div>
            </div>

            {/* Preview */}
            {previewRows.length > 0 && expr.trim() && (
              <div>
                <label className="text-xs text-slate-400 font-medium mb-2 block flex items-center gap-1.5">
                  {previewError
                    ? <AlertCircle size={12} className="text-red-400" />
                    : <CheckCircle2 size={12} className="text-green-400" />
                  }
                  Превью на реальных данных
                </label>
                <div className="bg-slate-800 border border-slate-700 rounded-xl overflow-hidden">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="bg-slate-700/50">
                        {availableCols.slice(0, 3).map(c => (
                          <th key={c} className="px-3 py-1.5 text-left text-slate-400 font-medium truncate max-w-[100px]">{c}</th>
                        ))}
                        <th className="px-3 py-1.5 text-left text-green-400 font-semibold">→ {colName || 'Результат'}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {previewRows.map((row, i) => (
                        <tr key={i} className={i % 2 === 0 ? 'bg-slate-900/50' : ''}>
                          {availableCols.slice(0, 3).map(c => (
                            <td key={c} className="px-3 py-1 text-slate-400 truncate max-w-[100px]">
                              {row[c] !== null && row[c] !== undefined ? String(row[c]) : '—'}
                            </td>
                          ))}
                          <td className={`px-3 py-1 font-mono font-semibold ${
                            evalPreview(expr, row) === '⚠ ошибка' ? 'text-red-400' : 'text-green-300'
                          }`}>
                            {evalPreview(expr, row)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* Actions */}
            <div className="flex gap-2 justify-end mt-auto pt-2">
              <button
                onClick={onClose}
                className="px-4 py-2 text-sm text-slate-400 hover:text-slate-200 transition-colors"
              >
                Отмена
              </button>
              <button
                disabled={!isValid || previewError}
                onClick={() => { if (isValid && !previewError) { onConfirm(colName.trim(), expr.trim()); onClose(); } }}
                className="px-5 py-2 text-sm font-semibold bg-green-600 hover:bg-green-500 disabled:bg-slate-700 disabled:text-slate-500 text-white rounded-xl transition-colors"
              >
                Добавить колонку
              </button>
            </div>
          </div>

          {/* Right: function reference */}
          <div className="w-56 border-l border-slate-700 flex flex-col flex-shrink-0">
            <button
              className="flex items-center gap-2 px-4 py-3 text-xs font-semibold text-slate-300 hover:bg-slate-800 transition-colors border-b border-slate-700"
              onClick={() => setShowFuncs(!showFuncs)}
            >
              <span className="flex-1 text-left">📚 Справочник функций</span>
              {showFuncs ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
            </button>

            <div className="flex-1 overflow-y-auto custom-scroll">
              {FUNC_GROUPS.map(group => (
                <div key={group.label}>
                  <button
                    className="w-full flex items-center gap-2 px-3 py-2 text-[11px] font-semibold text-slate-400 hover:bg-slate-800/50 transition-colors"
                    onClick={() => setExpandedGroup(expandedGroup === group.label ? null : group.label)}
                  >
                    <span className={`${group.color} flex-1 text-left`}>{group.label}</span>
                    {expandedGroup === group.label ? <ChevronDown size={10} /> : <ChevronRight size={10} />}
                  </button>

                  {expandedGroup === group.label && (
                    <div className="pb-2">
                      {group.funcs.map(fn => (
                        <button
                          key={fn.name}
                          className="w-full text-left px-3 py-2 hover:bg-slate-800 transition-colors group"
                          onClick={() => insertFunc(fn.example)}
                          title={fn.desc}
                        >
                          <div className="text-[10px] font-mono text-slate-300 group-hover:text-green-300 transition-colors truncate">
                            {fn.example}
                          </div>
                          <div className="text-[9px] text-slate-600 group-hover:text-slate-500 transition-colors">
                            {fn.desc}
                          </div>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              ))}

              {/* Columns quick insert */}
              <div>
                <div className="px-3 py-2 text-[11px] font-semibold text-slate-400 border-t border-slate-700">
                  Колонки
                </div>
                {availableCols.map(col => (
                  <button
                    key={col}
                    className="w-full text-left px-3 py-1 text-[10px] font-mono text-slate-400 hover:text-blue-300 hover:bg-slate-800 transition-colors truncate"
                    onClick={() => insertFunc(`[${col}]`)}
                  >
                    [{col}]
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
