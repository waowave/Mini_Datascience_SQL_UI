/**
 * SchemaInference — вычисляет схему (список колонок) после каждого шага пайплайна.
 * 
 * Это ключевой модуль: без него редакторы шагов не знают какие колонки
 * доступны на данном этапе. Например после FORMULA появляется новая колонка,
 * после GROUP — только колонки группировки + алиасы агрегатов,
 * после JOIN — колонки обеих таблиц, после RENAME — переименованные.
 */

import type { Step, ColumnMeta, TableMetadata } from '../types';

/**
 * Вычисляет список доступных колонок ПОСЛЕ выполнения шага stepIndex.
 * stepIndex = -1 означает "до любых шагов" = пустой список.
 */
export function deriveColumnsUpToStep(
  steps: Step[],
  stepIndex: number, // индекс шага включительно (или -1 для пустого)
  sources: TableMetadata[]
): ColumnMeta[] {
  let cols: ColumnMeta[] = [];

  const activeSteps = steps.slice(0, stepIndex + 1);

  for (const step of activeSteps) {
    if (!step.uiMeta.isActive) continue;
    cols = applyStepToSchema(step, cols, sources);
  }

  return cols;
}

/**
 * Вычисляет колонки доступные ДО данного шага (не включая его самого).
 * Используется в редакторе — показывает что доступно для конфигурации шага.
 */
export function deriveColumnsBeforeStep(
  steps: Step[],
  stepId: string,
  sources: TableMetadata[]
): ColumnMeta[] {
  const idx = steps.findIndex(s => s.id === stepId);
  if (idx <= 0) {
    // Это первый шаг — смотрим только если это FROM
    const first = steps[0];
    if (first && first.id === stepId && first.type === 'FROM') {
      // Для редактора FROM — вернём пустой список (выбирается источник)
      return [];
    }
    return [];
  }
  return deriveColumnsUpToStep(steps, idx - 1, sources);
}

/**
 * Применяет один шаг к схеме и возвращает новую схему.
 */
function applyStepToSchema(
  step: Step,
  current: ColumnMeta[],
  sources: TableMetadata[]
): ColumnMeta[] {
  const { type, params } = step;

  switch (type) {
    case 'FROM': {
      // Берём схему из источника
      const src = sources.find(s =>
        s.id === params.tableId || s.name === params.tableName
      );
      return src ? [...src.columns] : [];
    }

    case 'FILTER':
    case 'SORT':
    case 'LIMIT':
      // Не меняют колонки
      return current;

    case 'FORMULA': {
      const f = params.formula;
      if (!f) return current;
      // Добавляем новую колонку (или перезаписываем если имя совпадает)
      const existing = current.find(c => c.name === f.newCol);
      if (existing) {
        return current.map(c =>
          c.name === f.newCol ? { ...c, type: 'float' } : c
        );
      }
      return [...current, { name: f.newCol, type: 'float' }];
    }

    case 'JOIN': {
      const j = params.join;
      if (!j) return current;
      const rightSrc = sources.find(s =>
        s.id === j.targetTable || s.name === j.targetTableName
      );
      if (!rightSrc) return current;
      // Объединяем колонки, правые не дублируют левые
      const leftNames = new Set(current.map(c => c.name));
      const rightCols = rightSrc.columns.filter(c => !leftNames.has(c.name));
      return [...current, ...rightCols];
    }

    case 'GROUP': {
      const a = params.aggregate;
      if (!a) return current;
      // После GROUP BY — только колонки группировки + алиасы агрегатов
      const groupCols: ColumnMeta[] = a.groups.map(g => {
        const orig = current.find(c => c.name === g);
        return orig ?? { name: g, type: 'text' };
      });
      const aggCols: ColumnMeta[] = a.aggs.map(ag => {
        const alias = ag.alias ?? `${ag.func.replace(' ', '_')}_${ag.col}`;
        return { name: alias, type: 'float' };
      });
      return [...groupCols, ...aggCols];
    }

    case 'RENAME': {
      const r = params.rename;
      if (!r) return current;
      return current.map(c => {
        const rename = r.renames.find(x => x.from === c.name);
        return rename ? { ...c, name: rename.to } : c;
      });
    }

    case 'SELECT': {
      const sel = params.select;
      if (!sel || sel.columns.length === 0) return current;
      return sel.columns.map(name => {
        const orig = current.find(c => c.name === name);
        return orig ?? { name, type: 'text' };
      });
    }

    case 'TRANSFORM': {
      const ts = params.transforms ?? [];
      if (ts.length === 0) return current;
      const newCols: ColumnMeta[] = ts.map(t => {
        const alias = t.newCol || `${t.func}_${t.col}`;
        const numericFuncs = ['ABS','CEIL','FLOOR','ROUND','CAST_INT','CAST_FLOAT','LENGTH'];
        const type = numericFuncs.includes(t.func) ? 'float' : 'text';
        return { name: alias, type };
      });
      return [...current, ...newCols];
    }

    default:
      return current;
  }
}

/**
 * Возвращает строковые имена колонок (удобная обёртка).
 */
export function getColumnNames(
  steps: Step[],
  stepId: string,
  sources: TableMetadata[]
): string[] {
  return deriveColumnsBeforeStep(steps, stepId, sources).map(c => c.name);
}

/**
 * Возвращает имена колонок ПОСЛЕ текущего шага (для предпросмотра результата).
 */
export function getColumnNamesAfter(
  steps: Step[],
  stepId: string,
  sources: TableMetadata[]
): string[] {
  const idx = steps.findIndex(s => s.id === stepId);
  if (idx < 0) return [];
  return deriveColumnsUpToStep(steps, idx, sources).map(c => c.name);
}
