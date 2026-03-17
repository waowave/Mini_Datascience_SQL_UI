import { useState, useRef, useCallback, useEffect } from 'react';
import {
  X, Plus, Trash2, Info, Sparkles, Sigma, GripVertical,
  ChevronDown, ChevronRight, CheckCircle2, AlertCircle, Wand2
} from 'lucide-react';
import { useStore } from '../store/useStore';
import type { Step, FilterOperator, AggFunc, SortDir } from '../types';
import { stepToHuman } from '../engine/SQLCompiler';
import { getColumnNames } from '../engine/SchemaInference';

interface StepEditorProps {
  step: Step;
  pipelineId: string;
  onClose: () => void;
}

const FILTER_OPS: { value: FilterOperator; label: string }[] = [
  { value: '=', label: 'равно (=)' },
  { value: '!=', label: 'не равно (≠)' },
  { value: '>', label: 'больше (>)' },
  { value: '>=', label: 'больше или равно (≥)' },
  { value: '<', label: 'меньше (<)' },
  { value: '<=', label: 'меньше или равно (≤)' },
  { value: 'LIKE', label: 'содержит (LIKE)' },
  { value: 'NOT LIKE', label: 'не содержит' },
  { value: 'IS NULL', label: 'пустое (IS NULL)' },
  { value: 'IS NOT NULL', label: 'не пустое (IS NOT NULL)' },
  { value: 'IN', label: 'входит в список (IN)' },
];

const AGG_FUNCS: { value: AggFunc; label: string; grandmaLabel: string; color: string }[] = [
  { value: 'SUM', label: 'SUM', grandmaLabel: '∑ Сумма', color: 'text-green-400' },
  { value: 'AVG', label: 'AVG', grandmaLabel: '⌀ Среднее', color: 'text-blue-400' },
  { value: 'COUNT', label: 'COUNT', grandmaLabel: '# Количество', color: 'text-amber-400' },
  { value: 'COUNT DISTINCT', label: 'COUNT DISTINCT', grandmaLabel: '≠ Уникальных', color: 'text-purple-400' },
  { value: 'MIN', label: 'MIN', grandmaLabel: '↓ Минимум', color: 'text-cyan-400' },
  { value: 'MAX', label: 'MAX', grandmaLabel: '↑ Максимум', color: 'text-rose-400' },
];

const JOIN_TYPES = [
  { value: 'inner', label: 'Только совпадения (INNER)', desc: 'Оставить только строки, которые есть в обеих таблицах' },
  { value: 'left', label: 'Все из левой (LEFT)', desc: 'Все строки из основной таблицы + совпадения из другой' },
  { value: 'right', label: 'Все из правой (RIGHT)', desc: 'Все строки из второй таблицы + совпадения из основной' },
  { value: 'full', label: 'Все из обеих (FULL OUTER)', desc: 'Все строки из обеих таблиц' },
];

// ─── Formula справочник функций ───────────────────────────────────
const FUNC_GROUPS = [
  {
    label: 'Математика', color: 'text-blue-400', funcs: [
      { name: 'ROUND', example: 'ROUND([Цена], 2)', desc: 'Округлить до N знаков' },
      { name: 'ABS', example: 'ABS([Прибыль])', desc: 'Модуль числа' },
      { name: 'SQRT', example: 'SQRT([Площадь])', desc: 'Квадратный корень' },
      { name: 'POWER', example: 'POWER([X], 2)', desc: 'Возведение в степень' },
      { name: 'MOD', example: 'MOD([Число], 3)', desc: 'Остаток от деления' },
    ],
  },
  {
    label: 'Арифметика', color: 'text-green-400', funcs: [
      { name: 'Сложение', example: '[Цена] + [НДС]', desc: 'A + B' },
      { name: 'Вычитание', example: '[Цена] - [Скидка]', desc: 'A - B' },
      { name: 'Умножение', example: '[Цена] * [Количество]', desc: 'A * B' },
      { name: 'Деление', example: '[Выручка] / [Количество]', desc: 'A / B' },
      { name: 'Скобки', example: '([Цена] + [НДС]) * [Кол]', desc: 'Приоритет операций' },
    ],
  },
  {
    label: 'Готовые формулы', color: 'text-amber-400', funcs: [
      { name: 'Сумма продажи', example: '[Цена] * [Количество]', desc: 'Выручка по строке' },
      { name: 'Цена со скидкой', example: '[Цена] * (1 - [Скидка] / 100)', desc: 'С учётом % скидки' },
      { name: 'НДС 20%', example: 'ROUND([Цена] * 1.2, 2)', desc: 'Цена + 20%' },
      { name: 'Прирост %', example: '([Факт] - [План]) / [План] * 100', desc: 'Отклонение от плана' },
      { name: 'Маржа %', example: '([Выручка] - [Себест]) / [Выручка] * 100', desc: 'Рентабельность' },
    ],
  },
  {
    label: 'Текст', color: 'text-purple-400', funcs: [
      { name: 'UPPER', example: 'UPPER([Имя])', desc: 'В верхний регистр' },
      { name: 'LOWER', example: 'LOWER([Email])', desc: 'В нижний регистр' },
      { name: 'TRIM', example: 'TRIM([Название])', desc: 'Убрать пробелы' },
      { name: 'LENGTH', example: 'LENGTH([Код])', desc: 'Длина строки' },
      { name: 'SUBSTR', example: "SUBSTR([Код], 1, 3)", desc: 'Подстрока' },
      { name: 'CONCAT', example: "[Имя] || ' ' || [Фамилия]", desc: 'Склеить строки' },
      { name: 'REPLACE', example: "REPLACE([Телефон], '-', '')", desc: 'Заменить символы' },
    ],
  },
  {
    label: 'Условия', color: 'text-rose-400', funcs: [
      { name: 'CASE простой', example: "CASE WHEN [Сумма] > 1000 THEN 'Крупный' ELSE 'Мелкий' END", desc: 'Если/Иначе' },
      { name: 'COALESCE', example: 'COALESCE([Значение], 0)', desc: 'Заменить NULL на 0' },
      { name: 'NULLIF', example: 'NULLIF([Делитель], 0)', desc: 'NULL если = 0 (защита от деления)' },
      { name: 'IIF', example: "IIF([Флаг] = 1, 'Да', 'Нет')", desc: 'Короткий if/else' },
    ],
  },
];

// ─── Transform функции ─────────────────────────────────────────────
const TRANSFORM_FUNCS = [
  { group: 'Текст', color: 'text-purple-400', items: [
    { func: 'UPPER', label: 'UPPER — Верхний регистр', desc: 'Привет → ПРИВЕТ' },
    { func: 'LOWER', label: 'LOWER — Нижний регистр', desc: 'ПРИВЕТ → привет' },
    { func: 'TRIM', label: 'TRIM — Убрать пробелы', desc: '  текст  → текст' },
    { func: 'LENGTH', label: 'LENGTH — Длина строки', desc: 'текст → 5' },
  ]},
  { group: 'Числа', color: 'text-blue-400', items: [
    { func: 'ROUND', label: 'ROUND — Округлить', desc: '3.14159 → 3.14', hasArg: true, argLabel: 'Знаков после запятой', argDefault: '2' },
    { func: 'ABS', label: 'ABS — Модуль', desc: '-5 → 5' },
    { func: 'CEIL', label: 'CEIL — Округл. вверх', desc: '3.1 → 4' },
    { func: 'FLOOR', label: 'FLOOR — Округл. вниз', desc: '3.9 → 3' },
    { func: 'CAST_INT', label: 'Преобразовать в целое', desc: '"42" → 42' },
    { func: 'CAST_FLOAT', label: 'Преобразовать в дробное', desc: '"3.14" → 3.14' },
    { func: 'CAST_TEXT', label: 'Преобразовать в текст', desc: '42 → "42"' },
  ]},
  { group: 'Null / Пустые', color: 'text-amber-400', items: [
    { func: 'COALESCE', label: 'COALESCE — Заменить NULL', desc: 'NULL → значение по умолчанию', hasArg: true, argLabel: 'Значение если пусто', argDefault: '0' },
    { func: 'NULLIF', label: 'NULLIF — Обнулить значение', desc: 'Если = X → NULL', hasArg: true, argLabel: 'Значение для замены', argDefault: '0' },
  ]},
];

// ─── Preview eval ─────────────────────────────────────────────────
function evalPreview(expr: string, row: Record<string, any>): string {
  try {
    let code = expr.replace(/\[([^\]]+)\]/g, (_, col) => {
      const v = row[col];
      if (v === null || v === undefined) return '0';
      if (typeof v === 'string') return JSON.stringify(v);
      return String(v);
    });
    code = code
      .replace(/ROUND\s*\(([^,]+),\s*(\d+)\)/gi, 'Math.round(($1)*Math.pow(10,$2))/Math.pow(10,$2)')
      .replace(/ABS\s*\(/gi, 'Math.abs(')
      .replace(/SQRT\s*\(/gi, 'Math.sqrt(')
      .replace(/POWER\s*\(/gi, 'Math.pow(')
      .replace(/UPPER\s*\(([^)]+)\)/gi, '(($1).toString().toUpperCase())')
      .replace(/LOWER\s*\(([^)]+)\)/gi, '(($1).toString().toLowerCase())')
      .replace(/LENGTH\s*\(([^)]+)\)/gi, '(($1).toString().length)');
    // eslint-disable-next-line no-new-func
    const result = new Function('Math', 'return ' + code)(Math);
    if (result === null || result === undefined) return '—';
    if (typeof result === 'number') return result.toLocaleString('ru-RU', { maximumFractionDigits: 4 });
    return String(result);
  } catch {
    return '⚠ ошибка';
  }
}

// ─── Shared UI primitives ─────────────────────────────────────────
function FieldSelect({ value, onChange, placeholder = 'Колонка...', columns }: {
  value: string; onChange: (v: string) => void; placeholder?: string; columns: string[];
}) {
  return (
    <select
      className="flex-1 bg-slate-700 border border-slate-600 rounded-lg px-2 py-1.5 text-sm text-slate-200 outline-none focus:border-blue-500 min-w-0"
      value={value}
      onChange={(e) => onChange(e.target.value)}
    >
      <option value="">{placeholder}</option>
      {columns.map((c) => <option key={c} value={c}>{c}</option>)}
    </select>
  );
}

function TextInput({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder?: string }) {
  return (
    <input
      className="flex-1 bg-slate-700 border border-slate-600 rounded-lg px-2 py-1.5 text-sm text-slate-200 outline-none focus:border-blue-500 min-w-0"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
    />
  );
}

// ─── FORMULA editor (full FormulaBuilder embedded) ────────────────
function FormulaEditor({ params, onChange, columns, previewRows }: any) {
  const f = params.formula ?? { newCol: 'Новая_колонка', expr: '' };
  const [expandedGroup, setExpandedGroup] = useState<string | null>('Готовые формулы');
  const [acOpen, setAcOpen] = useState(false);
  const [acQuery, setAcQuery] = useState('');
  const [acPos, setAcPos] = useState(0);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const setF = (patch: any) => onChange({ ...params, formula: { ...f, ...patch } });

  const filteredCols = (columns as string[]).filter((c: string) =>
    c.toLowerCase().includes(acQuery.toLowerCase())
  );

  const handleExprChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const val = e.target.value;
    const pos = e.target.selectionStart ?? 0;
    setF({ expr: val });
    setAcPos(pos);
    const before = val.slice(0, pos);
    const match = before.match(/\[([^\]]*)$/);
    if (match) { setAcQuery(match[1]); setAcOpen(true); }
    else setAcOpen(false);
  }, [f]);

  const insertCol = useCallback((col: string) => {
    const val = f.expr;
    const before = val.slice(0, acPos);
    const after = val.slice(acPos);
    const matchStart = before.lastIndexOf('[');
    const newVal = val.slice(0, matchStart) + `[${col}]` + after;
    setF({ expr: newVal });
    setAcOpen(false);
    textareaRef.current?.focus();
  }, [f.expr, acPos]);

  const insertFunc = (example: string) => {
    setF({ expr: f.expr ? f.expr + ' ' + example : example });
    textareaRef.current?.focus();
  };

  const isValid = f.expr.trim().length > 0 && f.newCol.trim().length > 0;
  const previewError = previewRows.length > 0 && isValid && evalPreview(f.expr, previewRows[0]) === '⚠ ошибка';

  useEffect(() => {
    const close = () => setAcOpen(false);
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, []);

  return (
    <div className="flex flex-1 min-h-0 overflow-hidden">
      {/* Left: editor */}
      <div className="flex-1 flex flex-col gap-4 p-5 overflow-y-auto custom-scroll">
        {/* Column name */}
        <div>
          <label className="text-xs text-slate-400 font-medium mb-1.5 block">Название новой колонки</label>
          <input
            className="w-full bg-slate-800 border border-slate-600 rounded-xl px-3 py-2.5 text-sm text-slate-200 outline-none focus:border-green-500 font-mono transition-colors"
            value={f.newCol}
            onChange={e => setF({ newCol: e.target.value.replace(/\s+/g, '_') })}
            placeholder="Итого_руб"
          />
          <p className="text-[10px] text-slate-600 mt-1">Пробелы автоматически заменяются на _</p>
        </div>

        {/* Formula input */}
        <div className="relative">
          <label className="text-xs text-slate-400 font-medium mb-1.5 block">Формула</label>
          <div className="relative">
            <div className="absolute top-3 left-3 text-slate-500 text-sm font-mono select-none z-10">=</div>
            <textarea
              ref={textareaRef}
              className={`w-full bg-slate-800 border rounded-xl pl-7 pr-3 py-2.5 text-sm text-slate-200 outline-none font-mono resize-none h-28 transition-colors ${
                previewError ? 'border-red-500 focus:border-red-400' : 'border-slate-600 focus:border-green-500'
              }`}
              value={f.expr}
              onChange={handleExprChange}
              onKeyDown={e => {
                if (acOpen && e.key === 'Tab' && filteredCols.length > 0) { e.preventDefault(); insertCol(filteredCols[0]); }
                if (acOpen && e.key === 'Escape') setAcOpen(false);
              }}
              placeholder="[Цена] * [Количество]"
              spellCheck={false}
            />
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
                <div className="px-3 py-1 text-[10px] text-slate-600 border-t border-slate-700">Tab — вставить первый</div>
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
        {previewRows.length > 0 && f.expr.trim() && (
          <div>
            <label className="text-xs text-slate-400 font-medium mb-2 flex items-center gap-1.5">
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
                    {(columns as string[]).slice(0, 3).map((c: string) => (
                      <th key={c} className="px-3 py-1.5 text-left text-slate-400 font-medium truncate max-w-[100px]">{c}</th>
                    ))}
                    <th className="px-3 py-1.5 text-left text-green-400 font-semibold">→ {f.newCol || 'Результат'}</th>
                  </tr>
                </thead>
                <tbody>
                  {previewRows.slice(0, 3).map((row: any, i: number) => (
                    <tr key={i} className={i % 2 === 0 ? 'bg-slate-900/50' : ''}>
                      {(columns as string[]).slice(0, 3).map((c: string) => (
                        <td key={c} className="px-3 py-1 text-slate-400 truncate max-w-[100px]">
                          {row[c] !== null && row[c] !== undefined ? String(row[c]) : '—'}
                        </td>
                      ))}
                      <td className={`px-3 py-1 font-mono font-semibold ${
                        evalPreview(f.expr, row) === '⚠ ошибка' ? 'text-red-400' : 'text-green-300'
                      }`}>
                        {evalPreview(f.expr, row)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>

      {/* Right: function reference */}
      <div className="w-60 border-l border-slate-700 flex flex-col flex-shrink-0">
        <div className="px-4 py-3 border-b border-slate-700 text-[11px] font-semibold text-slate-400 uppercase tracking-wider flex items-center gap-2">
          <Sparkles size={11} className="text-green-400" /> Справочник
        </div>
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
                <div className="pb-1">
                  {group.funcs.map(fn => (
                    <button
                      key={fn.name}
                      className="w-full text-left px-3 py-2 hover:bg-slate-800 transition-colors group"
                      onClick={() => insertFunc(fn.example)}
                      title={fn.desc}
                    >
                      <div className="text-[10px] font-mono text-slate-300 group-hover:text-green-300 transition-colors truncate">{fn.example}</div>
                      <div className="text-[9px] text-slate-600 group-hover:text-slate-500 transition-colors">{fn.desc}</div>
                    </button>
                  ))}
                </div>
              )}
            </div>
          ))}
          {/* Quick column insert */}
          <div>
            <div className="px-3 py-2 text-[11px] font-semibold text-slate-400 border-t border-slate-700">Колонки</div>
            {(columns as string[]).map((col: string) => (
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
  );
}

// ─── GROUP editor (full AggregationPanel embedded) ────────────────
function GroupEditor({ params, onChange, columns, grandmaMode }: any) {
  const a = params.aggregate ?? { groups: [], aggs: [] };
  const [dragOver, setDragOver] = useState<'groups' | 'aggs' | null>(null);

  const setA = (patch: any) => onChange({ ...params, aggregate: { ...a, ...patch } });

  const toggleGroup = (col: string) => {
    const groups = a.groups.includes(col)
      ? a.groups.filter((g: string) => g !== col)
      : [...a.groups, col];
    setA({ groups });
  };

  const addAgg = (col: string) => {
    const func: AggFunc = 'SUM';
    setA({ aggs: [...a.aggs, { col, func, alias: `${func}_${col}` }] });
  };

  const removeAgg = (i: number) => setA({ aggs: a.aggs.filter((_: any, idx: number) => idx !== i) });

  const updateAgg = (i: number, patch: any) => {
    const next = a.aggs.map((ag: any, idx: number) => {
      if (idx !== i) return ag;
      const updated = { ...ag, ...patch };
      if (patch.func || patch.col) updated.alias = `${updated.func.replace(' ', '_')}_${updated.col}`;
      return updated;
    });
    setA({ aggs: next });
  };

  const availableForGroup = (columns as string[]).filter((c: string) => !a.groups.includes(c));

  return (
    <div className="flex flex-1 min-h-0 overflow-hidden">
      {/* Left: available columns */}
      <div className="w-44 border-r border-slate-700 flex flex-col flex-shrink-0">
        <div className="px-3 py-2.5 text-[11px] font-semibold text-slate-400 border-b border-slate-700 uppercase tracking-wider">
          Колонки
        </div>
        <div className="flex-1 overflow-y-auto custom-scroll p-2 flex flex-col gap-1">
          {(columns as string[]).map((col: string) => (
            <div
              key={col}
              className="group flex items-center gap-1.5 px-2 py-1.5 bg-slate-800 hover:bg-slate-700 rounded-lg cursor-grab text-xs text-slate-200 transition-colors"
              draggable
              onDragStart={e => e.dataTransfer.setData('col', col)}
            >
              <GripVertical size={10} className="text-slate-600 group-hover:text-slate-400 flex-shrink-0" />
              <span className="flex-1 truncate">{col}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Center: builder */}
      <div className="flex-1 flex flex-col overflow-y-auto custom-scroll">
        {/* Groups zone */}
        <div className="p-4 border-b border-slate-700/50">
          <div className="flex items-center gap-2 mb-3">
            <div className="w-7 h-7 rounded-lg bg-blue-500/20 flex items-center justify-center flex-shrink-0">
              <span className="text-blue-400 text-sm font-bold">≡</span>
            </div>
            <div>
              <p className="text-sm font-semibold text-slate-200">
                {grandmaMode ? 'Разбить строки по...' : 'GROUP BY — Группировать по'}
              </p>
              <p className="text-[11px] text-slate-500">
                {grandmaMode
                  ? 'Каждое уникальное значение станет отдельной строкой'
                  : 'Уникальные комбинации образуют строки результата'}
              </p>
            </div>
          </div>
          <div
            className={`min-h-[72px] border-2 border-dashed rounded-xl p-2 flex flex-wrap gap-2 items-start content-start transition-colors ${
              dragOver === 'groups' ? 'border-blue-500 bg-blue-500/10' : 'border-slate-700 hover:border-slate-500'
            }`}
            onDragOver={e => { e.preventDefault(); setDragOver('groups'); }}
            onDragLeave={() => setDragOver(null)}
            onDrop={e => { e.preventDefault(); const col = e.dataTransfer.getData('col'); if (col) toggleGroup(col); setDragOver(null); }}
          >
            {a.groups.length === 0 && (
              <p className="w-full text-center text-[11px] text-slate-600 py-2">Перетащите колонку или кликните ниже</p>
            )}
            {a.groups.map((g: string) => (
              <span key={g} className="flex items-center gap-1.5 px-2.5 py-1 bg-blue-600/20 border border-blue-500/40 text-blue-300 rounded-lg text-xs font-medium">
                {g}
                <button onClick={() => toggleGroup(g)} className="hover:text-red-400 transition-colors"><X size={10} /></button>
              </span>
            ))}
            {availableForGroup.length > 0 && (
              <div className="flex flex-wrap gap-1 mt-1 w-full">
                {availableForGroup.slice(0, 8).map((col: string) => (
                  <button key={col} onClick={() => toggleGroup(col)}
                    className="px-2 py-0.5 text-[10px] text-slate-500 hover:text-blue-300 border border-slate-700 hover:border-blue-500/40 rounded-md transition-colors">
                    + {col}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Aggs zone */}
        <div className="p-4">
          <div className="flex items-center gap-2 mb-3">
            <div className="w-7 h-7 rounded-lg bg-rose-500/20 flex items-center justify-center flex-shrink-0">
              <Sigma size={13} className="text-rose-400" />
            </div>
            <div>
              <p className="text-sm font-semibold text-slate-200">
                {grandmaMode ? 'Что посчитать?' : 'Агрегатные функции'}
              </p>
              <p className="text-[11px] text-slate-500">
                {grandmaMode ? 'Для каждой группы будет вычислено это значение' : 'Применяются к каждой группе строк'}
              </p>
            </div>
          </div>
          <div
            className={`min-h-[80px] border-2 border-dashed rounded-xl p-2 flex flex-col gap-2 transition-colors ${
              dragOver === 'aggs' ? 'border-rose-500 bg-rose-500/10' : 'border-slate-700 hover:border-slate-500'
            }`}
            onDragOver={e => { e.preventDefault(); setDragOver('aggs'); }}
            onDragLeave={() => setDragOver(null)}
            onDrop={e => { e.preventDefault(); const col = e.dataTransfer.getData('col'); if (col) addAgg(col); setDragOver(null); }}
          >
            {a.aggs.length === 0 && (
              <p className="w-full text-center text-[11px] text-slate-600 py-3">Перетащите колонку сюда</p>
            )}
            {a.aggs.map((agg: any, idx: number) => (
              <div key={idx} className="flex items-center gap-2 bg-slate-800 border border-slate-700 rounded-xl px-3 py-2">
                <select
                  className="bg-slate-700 border border-slate-600 rounded-lg px-2 py-1 text-xs text-slate-200 outline-none focus:border-rose-500"
                  value={agg.func}
                  onChange={e => updateAgg(idx, { func: e.target.value })}
                >
                  {AGG_FUNCS.map(o => (
                    <option key={o.value} value={o.value}>{grandmaMode ? o.grandmaLabel : o.value}</option>
                  ))}
                </select>
                <span className="text-xs text-slate-500">→</span>
                <select
                  className="flex-1 bg-slate-700 border border-slate-600 rounded-lg px-2 py-1 text-xs text-slate-200 outline-none focus:border-rose-500"
                  value={agg.col}
                  onChange={e => updateAgg(idx, { col: e.target.value })}
                >
                  <option value="">— колонка —</option>
                  {(columns as string[]).map((c: string) => <option key={c} value={c}>{c}</option>)}
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
            <div className="flex flex-wrap gap-1 mt-1">
              {(columns as string[]).slice(0, 6).map((col: string) => (
                <button key={col} onClick={() => addAgg(col)}
                  className="flex items-center gap-1 px-2 py-0.5 text-[10px] text-slate-500 hover:text-rose-300 border border-slate-700 hover:border-rose-500/40 rounded-md transition-colors">
                  <Plus size={8} /> Σ {col}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Right: explanation */}
      <div className="w-48 border-l border-slate-700 flex flex-col flex-shrink-0 p-4">
        <div className="flex items-center gap-1.5 mb-3">
          <Info size={12} className="text-blue-400" />
          <span className="text-[11px] font-semibold text-slate-400">Объяснение</span>
        </div>
        {a.groups.length > 0 || a.aggs.length > 0 ? (
          <div className="text-[11px] text-slate-400 leading-relaxed space-y-3">
            {a.groups.length > 0 && (
              <div>
                <p className="text-slate-300 font-medium mb-1">Разбивка по:</p>
                <p>Строки сгруппируются по <span className="text-blue-300">{a.groups.join(', ')}</span>. Каждая уникальная комбинация — одна итоговая строка.</p>
              </div>
            )}
            {a.aggs.length > 0 && (
              <div>
                <p className="text-slate-300 font-medium mb-1">Расчёты:</p>
                {a.aggs.map((ag: any, i: number) => (
                  <p key={i} className="mb-1">
                    • <span className="text-rose-300">{ag.func}</span> колонки <span className="text-slate-200">{ag.col}</span>
                    {' → '}<span className="text-slate-400 font-mono text-[10px]">{ag.alias}</span>
                  </p>
                ))}
              </div>
            )}
            {a.groups.length === 0 && a.aggs.length > 0 && (
              <div className="p-2 bg-amber-500/10 border border-amber-500/30 rounded-lg">
                <p className="text-amber-400 text-[10px]">⚠ Без группировки — получите одну строку по всей таблице</p>
              </div>
            )}
          </div>
        ) : (
          <p className="text-[11px] text-slate-600">Добавьте колонки чтобы увидеть объяснение...</p>
        )}
      </div>
    </div>
  );
}

// ─── TRANSFORM editor ─────────────────────────────────────────────
function TransformEditor({ params, onChange, columns }: any) {
  const transforms: any[] = params.transforms ?? [];

  const add = () => onChange({ ...params, transforms: [...transforms, { col: '', func: 'UPPER', arg: '', newCol: '' }] });
  const remove = (i: number) => onChange({ ...params, transforms: transforms.filter((_: any, idx: number) => idx !== i) });
  const update = (i: number, patch: any) => {
    const next = transforms.map((t: any, idx: number) => {
      if (idx !== i) return t;
      const updated = { ...t, ...patch };
      if (!updated.newCol || updated.newCol === `${t.func}_${t.col}`) {
        updated.newCol = `${updated.func}_${updated.col}`;
      }
      return updated;
    });
    onChange({ ...params, transforms: next });
  };

  const getFuncInfo = (funcName: string) => {
    for (const g of TRANSFORM_FUNCS) {
      const item = g.items.find(i => i.func === funcName);
      if (item) return item;
    }
    return null;
  };

  const toSQL = (t: any) => {
    if (!t.col) return '—';
    switch (t.func) {
      case 'UPPER': return `UPPER("${t.col}")`;
      case 'LOWER': return `LOWER("${t.col}")`;
      case 'TRIM': return `TRIM("${t.col}")`;
      case 'LENGTH': return `LENGTH("${t.col}")`;
      case 'ABS': return `ABS("${t.col}")`;
      case 'CEIL': return `CEIL("${t.col}")`;
      case 'FLOOR': return `FLOOR("${t.col}")`;
      case 'ROUND': return `ROUND("${t.col}", ${t.arg || 2})`;
      case 'CAST_INT': return `CAST("${t.col}" AS INTEGER)`;
      case 'CAST_FLOAT': return `CAST("${t.col}" AS FLOAT)`;
      case 'CAST_TEXT': return `CAST("${t.col}" AS TEXT)`;
      case 'COALESCE': return `COALESCE("${t.col}", ${t.arg || 0})`;
      case 'NULLIF': return `NULLIF("${t.col}", ${t.arg || 0})`;
      default: return `${t.func}("${t.col}")`;
    }
  };

  return (
    <div className="p-5 space-y-4 overflow-y-auto custom-scroll flex-1">
      <div className="flex items-center gap-2 p-3 bg-purple-500/10 border border-purple-500/30 rounded-xl">
        <Wand2 size={14} className="text-purple-400 flex-shrink-0" />
        <p className="text-xs text-purple-300">
          Применяет SQL функции к существующим колонкам. Создаёт новую колонку с результатом (оригинал не изменяется).
        </p>
      </div>

      {transforms.map((t: any, i: number) => {
        const info = getFuncInfo(t.func);
        return (
          <div key={i} className="bg-slate-800 border border-slate-700 rounded-xl p-4 space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-slate-300">Преобразование #{i + 1}</span>
              <button onClick={() => remove(i)} className="text-slate-600 hover:text-red-400 transition-colors">
                <Trash2 size={13} />
              </button>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-[10px] text-slate-500 mb-1 block">Исходная колонка</label>
                <FieldSelect value={t.col} onChange={v => update(i, { col: v })} columns={columns} />
              </div>
              <div>
                <label className="text-[10px] text-slate-500 mb-1 block">Функция</label>
                <select
                  className="w-full bg-slate-700 border border-slate-600 rounded-lg px-2 py-1.5 text-sm text-slate-200 outline-none focus:border-purple-500"
                  value={t.func}
                  onChange={e => update(i, { func: e.target.value })}
                >
                  {TRANSFORM_FUNCS.map(g => (
                    <optgroup key={g.group} label={g.group}>
                      {g.items.map(item => (
                        <option key={item.func} value={item.func}>{item.label}</option>
                      ))}
                    </optgroup>
                  ))}
                </select>
              </div>
            </div>

            {info && (info as any).hasArg && (
              <div>
                <label className="text-[10px] text-slate-500 mb-1 block">{(info as any).argLabel}</label>
                <input
                  className="w-full bg-slate-700 border border-slate-600 rounded-lg px-2 py-1.5 text-sm text-slate-200 outline-none focus:border-purple-500 font-mono"
                  value={t.arg || (info as any).argDefault}
                  onChange={e => update(i, { arg: e.target.value })}
                  placeholder={(info as any).argDefault}
                />
              </div>
            )}

            <div>
              <label className="text-[10px] text-slate-500 mb-1 block">Название новой колонки</label>
              <input
                className="w-full bg-slate-700 border border-slate-600 rounded-lg px-2 py-1.5 text-sm text-slate-200 outline-none focus:border-purple-500 font-mono"
                value={t.newCol}
                onChange={e => update(i, { newCol: e.target.value })}
                placeholder={`${t.func}_${t.col || 'колонка'}`}
              />
            </div>

            {t.col && (
              <div className="flex items-center gap-2 p-2 bg-slate-900/50 rounded-lg">
                <span className="text-[10px] text-slate-500">SQL:</span>
                <code className="text-[10px] text-purple-300 font-mono">{toSQL(t)} AS "{t.newCol || `${t.func}_${t.col}`}"</code>
              </div>
            )}

            {info && (
              <p className="text-[10px] text-slate-500">💡 {info.desc}</p>
            )}
          </div>
        );
      })}

      <button
        onClick={add}
        className="w-full flex items-center justify-center gap-2 py-2.5 border-2 border-dashed border-slate-700 hover:border-purple-500/50 hover:text-purple-300 text-slate-500 text-sm rounded-xl transition-colors"
      >
        <Plus size={14} /> Добавить преобразование
      </button>
    </div>
  );
}

// ─── Other compact editors ────────────────────────────────────────
function FromEditor({ params, onChange, sources }: any) {
  return (
    <div className="p-5 space-y-3">
      <label className="block text-sm font-medium text-slate-300">Источник данных</label>
      <select
        className="w-full bg-slate-700 border border-slate-600 rounded-xl px-3 py-2.5 text-sm text-slate-200 outline-none focus:border-blue-500"
        value={params.tableId ?? ''}
        onChange={(e) => {
          const src = sources.find((s: any) => s.id === e.target.value);
          onChange({ ...params, tableId: e.target.value, tableName: src?.name ?? '' });
        }}
      >
        <option value="">— выберите таблицу —</option>
        {sources.map((s: any) => (
          <option key={s.id} value={s.id}>{s.name} ({s.rowCount ?? '?'} строк)</option>
        ))}
      </select>
    </div>
  );
}

function FilterEditor({ params, onChange, columns }: any) {
  const conditions = params.conditions ?? [];
  const update = (i: number, field: string, val: any) => {
    onChange({ ...params, conditions: conditions.map((c: any, idx: number) => idx === i ? { ...c, [field]: val } : c) });
  };
  const add = () => onChange({ ...params, conditions: [...conditions, { col: '', op: '=', val: '', conjunction: 'AND' }] });
  const remove = (i: number) => onChange({ ...params, conditions: conditions.filter((_: any, idx: number) => idx !== i) });

  return (
    <div className="p-5 space-y-3">
      <label className="block text-sm font-medium text-slate-300">Условия фильтрации</label>
      {conditions.map((c: any, i: number) => (
        <div key={i} className="space-y-2">
          {i > 0 && (
            <div className="flex items-center gap-2">
              <div className="flex-1 h-px bg-slate-700" />
              <select className="bg-slate-700 border border-slate-600 rounded-lg px-2 py-1 text-xs text-slate-300 outline-none"
                value={c.conjunction ?? 'AND'} onChange={(e) => update(i, 'conjunction', e.target.value)}>
                <option value="AND">И (AND)</option>
                <option value="OR">ИЛИ (OR)</option>
              </select>
              <div className="flex-1 h-px bg-slate-700" />
            </div>
          )}
          <div className="flex gap-2 items-center">
            <FieldSelect value={c.col} onChange={(v) => update(i, 'col', v)} columns={columns} />
            <select className="bg-slate-700 border border-slate-600 rounded-lg px-2 py-1.5 text-sm text-slate-200 outline-none focus:border-blue-500"
              value={c.op} onChange={(e) => update(i, 'op', e.target.value)}>
              {FILTER_OPS.map(op => <option key={op.value} value={op.value}>{op.label}</option>)}
            </select>
            {c.op !== 'IS NULL' && c.op !== 'IS NOT NULL' && (
              <TextInput value={c.val ?? ''} onChange={(v) => update(i, 'val', v)} placeholder="Значение..." />
            )}
            <button onClick={() => remove(i)} className="p-1.5 text-red-400 hover:text-red-300"><Trash2 size={14} /></button>
          </div>
        </div>
      ))}
      <button onClick={add} className="flex items-center gap-2 text-sm text-blue-400 hover:text-blue-300 transition-colors">
        <Plus size={14} /> Добавить условие
      </button>
    </div>
  );
}

function JoinEditor({ params, onChange, columns, sources }: any) {
  const j = params.join ?? { targetTable: '', targetTableName: '', type: 'left', on: ['', ''] };
  const targetSource = sources.find((s: any) => s.id === j.targetTable);
  const targetCols = targetSource?.columns.map((c: any) => c.name) ?? [];
  const updateJoin = (field: string, val: any) => onChange({ ...params, join: { ...j, [field]: val } });

  return (
    <div className="p-5 space-y-4">
      <div>
        <label className="block text-sm font-medium text-slate-300 mb-2">Вторая таблица</label>
        <select className="w-full bg-slate-700 border border-slate-600 rounded-xl px-3 py-2.5 text-sm text-slate-200 outline-none focus:border-blue-500"
          value={j.targetTable}
          onChange={(e) => {
            const src = sources.find((s: any) => s.id === e.target.value);
            onChange({ ...params, join: { ...j, targetTable: e.target.value, targetTableName: src?.name ?? '' } });
          }}>
          <option value="">— выберите таблицу —</option>
          {sources.map((s: any) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
      </div>
      <div>
        <label className="block text-sm font-medium text-slate-300 mb-2">Тип объединения</label>
        <div className="space-y-2">
          {JOIN_TYPES.map(jt => (
            <label key={jt.value} className={`flex items-start gap-3 p-3 rounded-xl border cursor-pointer transition-all ${
              j.type === jt.value ? 'border-blue-500 bg-blue-500/10' : 'border-slate-700 hover:border-slate-600'}`}>
              <input type="radio" name="jointype" value={jt.value} checked={j.type === jt.value}
                onChange={() => updateJoin('type', jt.value)} className="mt-0.5" />
              <div>
                <div className="text-sm text-slate-200 font-medium">{jt.label}</div>
                <div className="text-xs text-slate-400">{jt.desc}</div>
              </div>
            </label>
          ))}
        </div>
      </div>
      <div>
        <label className="block text-sm font-medium text-slate-300 mb-2">Связь между таблицами</label>
        <div className="flex items-center gap-2">
          <div className="flex-1">
            <p className="text-xs text-slate-500 mb-1">Основная таблица</p>
            <FieldSelect value={j.on[0]} onChange={(v) => updateJoin('on', [v, j.on[1]])} columns={columns} />
          </div>
          <span className="text-slate-400 text-sm font-mono mt-4">=</span>
          <div className="flex-1">
            <p className="text-xs text-slate-500 mb-1">{j.targetTableName || 'Вторая таблица'}</p>
            <FieldSelect value={j.on[1]} onChange={(v) => updateJoin('on', [j.on[0], v])} columns={targetCols} />
          </div>
        </div>
      </div>
    </div>
  );
}

function SortEditor({ params, onChange, columns }: any) {
  const s = params.sort ?? { sorts: [] };
  const add = () => onChange({ ...params, sort: { sorts: [...s.sorts, { col: '', dir: 'ASC' }] } });
  const update = (i: number, field: string, val: any) => {
    onChange({ ...params, sort: { sorts: s.sorts.map((x: any, idx: number) => idx === i ? { ...x, [field]: val } : x) } });
  };
  const remove = (i: number) => onChange({ ...params, sort: { sorts: s.sorts.filter((_: any, idx: number) => idx !== i) } });

  return (
    <div className="p-5 space-y-3">
      <label className="block text-sm font-medium text-slate-300">Порядок сортировки</label>
      {s.sorts.map((x: any, i: number) => (
        <div key={i} className="flex gap-2 items-center">
          <span className="text-xs text-slate-500 w-6 text-center">{i + 1}</span>
          <FieldSelect value={x.col} onChange={(v) => update(i, 'col', v)} columns={columns} />
          <select className="bg-slate-700 border border-slate-600 rounded-lg px-2 py-1.5 text-sm text-slate-200 outline-none focus:border-blue-500"
            value={x.dir} onChange={(e) => update(i, 'dir', e.target.value as SortDir)}>
            <option value="ASC">▲ По возрастанию</option>
            <option value="DESC">▼ По убыванию</option>
          </select>
          <button onClick={() => remove(i)} className="p-1.5 text-red-400 hover:text-red-300"><Trash2 size={14} /></button>
        </div>
      ))}
      <button onClick={add} className="flex items-center gap-2 text-sm text-blue-400 hover:text-blue-300 transition-colors">
        <Plus size={14} /> Добавить сортировку
      </button>
    </div>
  );
}

function RenameEditor({ params, onChange, columns }: any) {
  const r = params.rename ?? { renames: [] };
  const add = () => onChange({ ...params, rename: { renames: [...r.renames, { from: '', to: '' }] } });
  const update = (i: number, field: string, val: any) => {
    onChange({ ...params, rename: { renames: r.renames.map((x: any, idx: number) => idx === i ? { ...x, [field]: val } : x) } });
  };
  const remove = (i: number) => onChange({ ...params, rename: { renames: r.renames.filter((_: any, idx: number) => idx !== i) } });

  return (
    <div className="p-5 space-y-3">
      <label className="block text-sm font-medium text-slate-300">Переименование колонок</label>
      {r.renames.map((x: any, i: number) => (
        <div key={i} className="flex gap-2 items-center">
          <FieldSelect value={x.from} onChange={(v) => update(i, 'from', v)} columns={columns} placeholder="Текущее имя..." />
          <span className="text-slate-400">→</span>
          <TextInput value={x.to} onChange={(v) => update(i, 'to', v)} placeholder="Новое имя..." />
          <button onClick={() => remove(i)} className="p-1.5 text-red-400 hover:text-red-300"><Trash2 size={14} /></button>
        </div>
      ))}
      <button onClick={add} className="flex items-center gap-2 text-sm text-blue-400 hover:text-blue-300 transition-colors">
        <Plus size={14} /> Добавить переименование
      </button>
    </div>
  );
}

function LimitEditor({ params, onChange }: any) {
  return (
    <div className="p-5 space-y-3">
      <div>
        <label className="block text-sm font-medium text-slate-300 mb-2">Максимум строк</label>
        <input type="number" min={1}
          className="w-full bg-slate-700 border border-slate-600 rounded-xl px-3 py-2.5 text-sm text-slate-200 outline-none focus:border-blue-500"
          value={params.limit ?? 100}
          onChange={(e) => onChange({ ...params, limit: Number(e.target.value) })} />
      </div>
      <div>
        <label className="block text-sm font-medium text-slate-300 mb-2">Пропустить строк (OFFSET)</label>
        <input type="number" min={0}
          className="w-full bg-slate-700 border border-slate-600 rounded-xl px-3 py-2.5 text-sm text-slate-200 outline-none focus:border-blue-500"
          value={params.offset ?? 0}
          onChange={(e) => onChange({ ...params, offset: Number(e.target.value) })} />
      </div>
    </div>
  );
}

function SelectEditor({ params, onChange, columns }: any) {
  const selected: string[] = params.select?.columns ?? [];
  const toggle = (col: string) => {
    const next = selected.includes(col) ? selected.filter(c => c !== col) : [...selected, col];
    onChange({ ...params, select: { columns: next } });
  };
  return (
    <div className="p-5 space-y-3">
      <label className="block text-sm font-medium text-slate-300">Выбрать колонки для отображения</label>
      <div className="flex flex-wrap gap-1.5">
        {columns.map((col: string) => (
          <button key={col}
            className={`px-3 py-1 rounded-full text-xs border transition-all ${
              selected.includes(col) ? 'border-blue-500 bg-blue-500/20 text-blue-300' : 'border-slate-600 text-slate-400 hover:border-slate-500'}`}
            onClick={() => toggle(col)}>{col}</button>
        ))}
      </div>
      {selected.length === 0 && <p className="text-xs text-slate-500">Если ничего не выбрано — показываются все колонки</p>}
    </div>
  );
}

// ─── Step type config ─────────────────────────────────────────────
const STEP_CONFIG: Record<string, { icon: string; color: string; title: string; wide?: boolean }> = {
  FROM:      { icon: '🗂', color: 'text-slate-300',  title: 'Источник данных' },
  FILTER:    { icon: '🔍', color: 'text-blue-400',   title: 'Фильтрация' },
  JOIN:      { icon: '🔗', color: 'text-amber-400',  title: 'Объединение таблиц' },
  FORMULA:   { icon: '✨', color: 'text-green-400',  title: 'Вычисляемая колонка', wide: true },
  GROUP:     { icon: 'Σ',  color: 'text-rose-400',   title: 'Группировка и агрегация', wide: true },
  TRANSFORM: { icon: '🪄', color: 'text-purple-400', title: 'Преобразование колонок' },
  SORT:      { icon: '↕',  color: 'text-cyan-400',   title: 'Сортировка' },
  RENAME:    { icon: '✏',  color: 'text-yellow-400', title: 'Переименование' },
  LIMIT:     { icon: '✂',  color: 'text-slate-400',  title: 'Ограничение строк' },
  SELECT:    { icon: '☑',  color: 'text-indigo-400', title: 'Выбор колонок' },
};

// ─── Main StepEditor ──────────────────────────────────────────────
export function StepEditor({ step, pipelineId, onClose }: StepEditorProps) {
  const { updateStep, sources, pipelines, activeTabId, grandmaMode, queryResult } = useStore();
  const pipeline = pipelines.find(p => p.id === activeTabId);

  const columns = pipeline ? getColumnNames(pipeline.steps, step.id, sources) : [];
  const previewRows: Record<string, any>[] = queryResult?.rows.slice(0, 5) ?? [];

  const [localParams, setLocalParams] = useState(() => JSON.parse(JSON.stringify(step.params)));

  const save = () => {
    updateStep(pipelineId, step.id, { params: localParams });
    onClose();
  };

  const human = stepToHuman({ ...step, params: localParams }, grandmaMode);
  const cfg = STEP_CONFIG[step.type] ?? { icon: '⚙', color: 'text-slate-300', title: step.type };
  const isWide = cfg.wide;

  return (
    <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4" onClick={onClose}>
      <div
        className={`bg-slate-900 border border-slate-700 rounded-2xl shadow-2xl flex flex-col overflow-hidden transition-all ${
          isWide ? 'w-full max-w-4xl h-[85vh]' : 'w-full max-w-2xl max-h-[85vh]'
        }`}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center gap-3 px-5 py-4 border-b border-slate-700 flex-shrink-0">
          <span className={`text-xl ${cfg.color}`}>{cfg.icon}</span>
          <div className="flex-1 min-w-0">
            <h2 className="text-sm font-semibold text-slate-100">{cfg.title}</h2>
            <p className="text-xs text-slate-500 truncate mt-0.5">{human}</p>
          </div>
          <button className="p-2 text-slate-400 hover:text-slate-200 hover:bg-slate-800 rounded-lg transition-colors" onClick={onClose}>
            <X size={16} />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
          {step.type === 'FROM'      && <FromEditor      params={localParams} onChange={setLocalParams} sources={sources} />}
          {step.type === 'FILTER'    && <FilterEditor    params={localParams} onChange={setLocalParams} columns={columns} />}
          {step.type === 'JOIN'      && <JoinEditor      params={localParams} onChange={setLocalParams} columns={columns} sources={sources} />}
          {step.type === 'FORMULA'   && <FormulaEditor   params={localParams} onChange={setLocalParams} columns={columns} previewRows={previewRows} />}
          {step.type === 'GROUP'     && <GroupEditor     params={localParams} onChange={setLocalParams} columns={columns} grandmaMode={grandmaMode} />}
          {step.type === 'TRANSFORM' && <TransformEditor params={localParams} onChange={setLocalParams} columns={columns} />}
          {step.type === 'SORT'      && <SortEditor      params={localParams} onChange={setLocalParams} columns={columns} />}
          {step.type === 'RENAME'    && <RenameEditor    params={localParams} onChange={setLocalParams} columns={columns} />}
          {step.type === 'LIMIT'     && <LimitEditor     params={localParams} onChange={setLocalParams} />}
          {step.type === 'SELECT'    && <SelectEditor    params={localParams} onChange={setLocalParams} columns={columns} />}
        </div>

        {/* Footer */}
        <div className="flex gap-3 px-5 py-4 border-t border-slate-700 flex-shrink-0">
          <button
            className="px-4 py-2 rounded-xl border border-slate-700 text-slate-400 text-sm hover:border-slate-500 hover:text-slate-300 transition-colors"
            onClick={onClose}
          >
            Отмена
          </button>
          <button
            className="flex-1 py-2 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-sm font-semibold transition-colors"
            onClick={save}
          >
            Применить
          </button>
        </div>
      </div>
    </div>
  );
}
