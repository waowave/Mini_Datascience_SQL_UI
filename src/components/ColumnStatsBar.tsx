/**
 * ColumnStatsBar — панель статистики по выбранной колонке.
 * Показывается внизу DataGrid при клике на заголовок.
 * Sum, Avg, Min, Max, Count, Nulls, Unique.
 */
import { useMemo } from 'react';
import { BarChart2 } from 'lucide-react';
import type { ColumnMeta } from '../types';

interface Props {
  colName: string;
  colMeta: ColumnMeta;
  rows: Record<string, any>[];
  totalRows: number;
  onClose: () => void;
  onAddFormula?: () => void;
  onAddFilter?: () => void;
  onAddGroup?: () => void;
  grandmaMode?: boolean;
}

function fmt(n: number, decimals = 2): string {
  return n.toLocaleString('ru-RU', { maximumFractionDigits: decimals });
}

export function ColumnStatsBar({
  colName, colMeta, rows, totalRows,
  onClose, onAddFormula, onAddFilter, onAddGroup,
  grandmaMode = false,
}: Props) {
  const stats = useMemo(() => {
    const vals = rows.map(r => r[colName]).filter(v => v !== null && v !== undefined && v !== '');
    const nullCount = totalRows - vals.length;
    const uniqueCount = new Set(vals.map(String)).size;

    if (colMeta.type === 'integer' || colMeta.type === 'float') {
      const nums = vals.map(Number).filter(n => !isNaN(n));
      if (nums.length === 0) return { type: 'numeric', count: vals.length, nullCount, uniqueCount, sum: 0, avg: 0, min: 0, max: 0 };
      const sum = nums.reduce((a, b) => a + b, 0);
      const avg = sum / nums.length;
      const min = Math.min(...nums);
      const max = Math.max(...nums);
      return { type: 'numeric', count: nums.length, nullCount, uniqueCount, sum, avg, min, max };
    }

    if (colMeta.type === 'text') {
      const lengths = vals.map(v => String(v).length);
      const avgLen = lengths.length ? lengths.reduce((a, b) => a + b, 0) / lengths.length : 0;
      // Top 3 frequent values
      const freq: Record<string, number> = {};
      vals.forEach(v => { const s = String(v); freq[s] = (freq[s] ?? 0) + 1; });
      const top = Object.entries(freq).sort((a, b) => b[1] - a[1]).slice(0, 3);
      return { type: 'text', count: vals.length, nullCount, uniqueCount, avgLen, top };
    }

    if (colMeta.type === 'date') {
      const sorted = vals.map(v => String(v)).sort();
      return { type: 'date', count: vals.length, nullCount, uniqueCount, min: sorted[0], max: sorted[sorted.length - 1] };
    }

    return { type: 'other', count: vals.length, nullCount, uniqueCount };
  }, [rows, colName, colMeta, totalRows]);

  const fillPct = totalRows > 0 ? Math.round((stats.count / totalRows) * 100) : 0;

  return (
    <div className="border-t border-slate-700 bg-slate-900/95 flex-shrink-0 px-4 py-3">
      <div className="flex items-start gap-5">
        {/* Column info */}
        <div className="flex-shrink-0">
          <div className="flex items-center gap-2 mb-1">
            <BarChart2 size={13} className="text-blue-400" />
            <span className="text-xs font-semibold text-slate-200">{colName}</span>
            <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-slate-700 text-slate-400 font-mono">
              {grandmaMode
                ? colMeta.type === 'integer' ? 'Целое' : colMeta.type === 'float' ? 'Число' : colMeta.type === 'date' ? 'Дата' : 'Текст'
                : colMeta.type.toUpperCase()
              }
            </span>
          </div>
          {/* Fill bar */}
          <div className="flex items-center gap-2">
            <div className="w-24 h-1.5 bg-slate-700 rounded-full overflow-hidden">
              <div
                className="h-full bg-blue-500 rounded-full transition-all"
                style={{ width: `${fillPct}%` }}
              />
            </div>
            <span className="text-[10px] text-slate-500">
              {fillPct}% заполнено · {stats.nullCount} пустых
            </span>
          </div>
        </div>

        {/* Stats */}
        <div className="flex items-center gap-6 flex-1 flex-wrap">
          {/* Universal */}
          <StatItem label={grandmaMode ? 'Всего' : 'COUNT'} value={fmt(stats.count, 0)} icon="🔢" />
          <StatItem label={grandmaMode ? 'Уникальных' : 'DISTINCT'} value={fmt(stats.uniqueCount, 0)} icon="≠" />

          {stats.type === 'numeric' && 'sum' in stats && (
            <>
              <StatItem label={grandmaMode ? 'Сумма' : 'SUM'} value={fmt(stats.sum ?? 0)} icon="Σ" highlight />
              <StatItem label={grandmaMode ? 'Среднее' : 'AVG'} value={fmt(stats.avg ?? 0)} icon="⌀" />
              <StatItem label={grandmaMode ? 'Мин' : 'MIN'} value={fmt(Number(stats.min ?? 0))} icon="↓" />
              <StatItem label={grandmaMode ? 'Макс' : 'MAX'} value={fmt(Number(stats.max ?? 0))} icon="↑" />
            </>
          )}

          {stats.type === 'text' && 'top' in stats && (
            <>
              <div>
                <p className="text-[10px] text-slate-500 mb-1">{grandmaMode ? 'Топ значений' : 'Top values'}</p>
                <div className="flex flex-col gap-0.5">
                  {(stats.top ?? []).map(([val, cnt]) => (
                    <div key={val} className="flex items-center gap-2">
                      <span className="text-[11px] text-slate-300 font-medium truncate max-w-[100px]">{val}</span>
                      <span className="text-[10px] text-slate-500">({cnt})</span>
                      {onAddFilter && (
                        <button
                          onClick={onAddFilter}
                          className="text-[9px] text-amber-400 hover:text-amber-300 transition-colors"
                        >
                          Фильтр
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              </div>
              <StatItem label={grandmaMode ? 'Сред. длина' : 'AVG LEN'} value={fmt('avgLen' in stats ? (stats.avgLen ?? 0) : 0, 1)} icon="Aa" />
            </>
          )}

          {stats.type === 'date' && 'min' in stats && (
            <>
              <StatItem label={grandmaMode ? 'С даты' : 'MIN DATE'} value={String(stats.min)} icon="📅" />
              <StatItem label={grandmaMode ? 'По дату' : 'MAX DATE'} value={String(stats.max)} icon="📅" />
            </>
          )}
        </div>

        {/* Quick actions */}
        <div className="flex flex-col gap-1 flex-shrink-0">
          {onAddFormula && (
            <button
              onClick={onAddFormula}
              className="px-2.5 py-1 text-[10px] text-green-300 hover:bg-green-500/15 border border-green-500/30 hover:border-green-500/60 rounded-lg transition-colors whitespace-nowrap"
            >
              ✦ {grandmaMode ? 'Формула' : 'Добавить формулу'}
            </button>
          )}
          {onAddGroup && (colMeta.type === 'integer' || colMeta.type === 'float') && (
            <button
              onClick={onAddGroup}
              className="px-2.5 py-1 text-[10px] text-rose-300 hover:bg-rose-500/15 border border-rose-500/30 hover:border-rose-500/60 rounded-lg transition-colors whitespace-nowrap"
            >
              Σ {grandmaMode ? 'Сделать сводку' : 'GROUP BY + SUM'}
            </button>
          )}
          <button
            onClick={onClose}
            className="px-2.5 py-1 text-[10px] text-slate-500 hover:text-slate-200 transition-colors"
          >
            ✕ Закрыть
          </button>
        </div>
      </div>
    </div>
  );
}

function StatItem({ label, value, icon, highlight }: {
  label: string; value: string; icon?: string; highlight?: boolean;
}) {
  return (
    <div className="flex flex-col">
      <span className="text-[9px] text-slate-600 uppercase tracking-wider mb-0.5">{label}</span>
      <span className={`text-sm font-semibold tabular-nums ${highlight ? 'text-green-300' : 'text-slate-200'}`}>
        {icon && <span className="text-[11px] mr-1 text-slate-500">{icon}</span>}
        {value}
      </span>
    </div>
  );
}
