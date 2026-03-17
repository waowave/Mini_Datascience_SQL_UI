import type {
  Pipeline,
  Step,
  CompileResult,
  FilterCondition,
} from '../types';

// ─────────────────────────────────────────────
//  Formula Parser: [Column Name] -> "Column Name"
// ─────────────────────────────────────────────
function parseFormula(expr: string): string {
  let result = expr.replace(/\[([^\]]+)\]/g, '"$1"');
  result = result
    .replace(/СУММ\s*\(/gi, 'SUM(')
    .replace(/СРЗНАЧ\s*\(/gi, 'AVG(')
    .replace(/МАКС\s*\(/gi, 'MAX(')
    .replace(/МИН\s*\(/gi, 'MIN(')
    .replace(/СЧЁТ\s*\(/gi, 'COUNT(')
    .replace(/CONCATENATE\s*\(/gi, 'CONCAT(')
    .replace(/ДЛСТР\s*\(/gi, 'LENGTH(')
    .replace(/ЛЕВСИМВ\s*\(/gi, 'LEFT(')
    .replace(/ПРАВСИМВ\s*\(/gi, 'RIGHT(')
    .replace(/ОКРУГЛ\s*\(/gi, 'ROUND(')
    .replace(/СЕГОДНЯ\(\)/gi, 'CURRENT_DATE')
    .replace(/ТДАТА\(\)/gi, 'NOW()');
  return result;
}

// ─────────────────────────────────────────────
//  Condition Builder
// ─────────────────────────────────────────────
function buildCondition(c: FilterCondition): string {
  const col = `"${c.col}"`;
  const op = c.op;

  if (op === 'IS NULL') return `${col} IS NULL`;
  if (op === 'IS NOT NULL') return `${col} IS NOT NULL`;

  if (op === 'IN') {
    const vals = Array.isArray(c.val)
      ? c.val.map((v: any) => (typeof v === 'string' ? `'${v}'` : v)).join(', ')
      : `'${c.val}'`;
    return `${col} IN (${vals})`;
  }

  const val =
    typeof c.val === 'string' && isNaN(Number(c.val))
      ? `'${c.val}'`
      : c.val;
  return `${col} ${op} ${val}`;
}

function buildWhereClause(conditions: FilterCondition[]): string {
  if (!conditions || conditions.length === 0) return '';
  return conditions
    .map((c, i) => {
      const part = buildCondition(c);
      if (i === 0) return part;
      return `${c.conjunction ?? 'AND'} ${part}`;
    })
    .join('\n  ');
}

// ─────────────────────────────────────────────
//  Human Descriptions
// ─────────────────────────────────────────────
const opLabels: Record<string, string> = {
  '=': 'равно',
  '!=': 'не равно',
  '>': 'больше',
  '>=': 'больше или равно',
  '<': 'меньше',
  '<=': 'меньше или равно',
  'LIKE': 'содержит',
  'NOT LIKE': 'не содержит',
  'IS NULL': 'пустое (нет данных)',
  'IS NOT NULL': 'не пустое',
  'IN': 'входит в список',
};

const joinTypeLabels: Record<string, string> = {
  inner: 'только совпадающие строки из обеих таблиц',
  left: 'все строки из левой + совпадения из правой',
  right: 'все строки из правой + совпадения из левой',
  full: 'все строки из обеих таблиц',
};

const aggFuncLabels: Record<string, string> = {
  SUM: 'Сумма',
  AVG: 'Среднее',
  COUNT: 'Количество',
  'COUNT DISTINCT': 'Уникальных',
  MIN: 'Минимум',
  MAX: 'Максимум',
};

export function stepToHuman(step: Step, grandma = false): string {
  const { type, params } = step;

  switch (type) {
    case 'FROM':
      return `📁 Берём данные из таблицы «${params.tableName ?? params.tableId}»`;

    case 'FILTER': {
      if (!params.conditions || params.conditions.length === 0)
        return '🔍 Фильтр (без условий)';
      const parts = params.conditions.map(
        (c) =>
          `«${c.col}» ${opLabels[c.op] ?? c.op}${c.op !== 'IS NULL' && c.op !== 'IS NOT NULL' ? ` "${c.val}"` : ''}`
      );
      return `🔍 Оставляем строки, где: ${parts.join('; ')}`;
    }

    case 'JOIN': {
      const j = params.join!;
      const typeLabel = joinTypeLabels[j.type] ?? j.type.toUpperCase();
      const termJoin = grandma ? 'Приклеиваем таблицу' : 'JOIN';
      return `🔗 ${termJoin} «${j.targetTableName}»: ${typeLabel}. Связь: «${j.on[0]}» = «${j.on[1]}»`;
    }

    case 'FORMULA': {
      const f = params.formula!;
      return `🧮 Новая колонка «${f.newCol}» = ${f.expr}`;
    }

    case 'GROUP': {
      const a = params.aggregate!;
      const groups = a.groups.join(', ');
      const calcs = a.aggs
        .map((ag) => `${aggFuncLabels[ag.func] ?? ag.func}(${ag.col})`)
        .join(', ');
      const term = grandma ? 'Сводка (Итого)' : 'GROUP BY';
      return `📊 ${term}: группируем по [${groups}], считаем: ${calcs}`;
    }

    case 'SORT': {
      const s = params.sort!;
      const parts = s.sorts.map((x) => `«${x.col}» ${x.dir === 'ASC' ? '▲ по возрастанию' : '▼ по убыванию'}`);
      return `🔢 Сортировка: ${parts.join(', ')}`;
    }

    case 'RENAME': {
      const r = params.rename!;
      const parts = r.renames.map((x) => `«${x.from}» → «${x.to}»`);
      return `✏️ Переименование: ${parts.join(', ')}`;
    }

    case 'LIMIT':
      return `✂️ Берём первые ${params.limit ?? '?'} строк${params.offset ? ` (пропускаем ${params.offset})` : ''}`;

    case 'SELECT': {
      const cols = params.select?.columns.join(', ') ?? '*';
      return `👁 Показываем только колонки: ${cols}`;
    }

    case 'TRANSFORM': {
      const ts = params.transforms ?? [];
      if (ts.length === 0) return '🪄 Преобразование колонок (не настроено)';
      const parts = ts.map(t => `${t.func}(${t.col}) → ${t.newCol}`);
      return `🪄 Преобразование: ${parts.join(', ')}`;
    }

    default:
      return `⚙️ Шаг: ${type}`;
  }
}

// ─────────────────────────────────────────────
//  CTE SQL Builder per Step
// ─────────────────────────────────────────────
function buildStepSQL(step: Step, prevCTE: string): string {
  const { type, params } = step;
  const from = prevCTE ? `FROM ${prevCTE}` : '';

  switch (type) {
    case 'FROM': {
      const tableName = params.tableName ?? params.tableId ?? 'unknown';
      return `SELECT * FROM "${tableName}"`;
    }

    case 'FILTER': {
      if (!params.conditions || params.conditions.length === 0) {
        return `SELECT * ${from}`;
      }
      const where = buildWhereClause(params.conditions);
      return `SELECT * ${from}\nWHERE ${where}`;
    }

    case 'JOIN': {
      const j = params.join!;
      const joinType = j.type.toUpperCase();
      return `SELECT * ${from}\n${joinType} JOIN "${j.targetTableName}" ON ${prevCTE}."${j.on[0]}" = "${j.targetTableName}"."${j.on[1]}"`;
    }

    case 'FORMULA': {
      const f = params.formula!;
      const expr = parseFormula(f.expr);
      return `SELECT *, (${expr}) AS "${f.newCol}" ${from}`;
    }

    case 'GROUP': {
      const a = params.aggregate!;
      const groupCols = a.groups.map((g) => `"${g}"`).join(', ');
      const aggCols = a.aggs
        .map((ag) => {
          const func =
            ag.func === 'COUNT DISTINCT'
              ? `COUNT(DISTINCT "${ag.col}")`
              : `${ag.func}("${ag.col}")`;
          const alias = ag.alias ?? `${ag.func.replace(' ', '_')}_${ag.col}`;
          return `${func} AS "${alias}"`;
        })
        .join(', ');
      const selectList = [groupCols, aggCols].filter(Boolean).join(', ');
      return `SELECT ${selectList} ${from}\nGROUP BY ${groupCols}`;
    }

    case 'SORT': {
      const s = params.sort!;
      const orderBy = s.sorts.map((x) => `"${x.col}" ${x.dir}`).join(', ');
      return `SELECT * ${from}\nORDER BY ${orderBy}`;
    }

    case 'RENAME': {
      const r = params.rename!;
      const renames = r.renames.map((x) => `"${x.from}" AS "${x.to}"`).join(', ');
      return `SELECT *, ${renames} ${from}`;
    }

    case 'LIMIT': {
      const limit = params.limit ?? 100;
      const offset = params.offset ? `\nOFFSET ${params.offset}` : '';
      return `SELECT * ${from}\nLIMIT ${limit}${offset}`;
    }

    case 'SELECT': {
      const cols = (params.select?.columns ?? [])
        .map((c) => `"${c}"`)
        .join(', ');
      return `SELECT ${cols || '*'} ${from}`;
    }

    case 'TRANSFORM': {
      const ts = params.transforms ?? [];
      if (ts.length === 0) return `SELECT * ${from}`;
      const exprs = ts.map(t => {
        const col = `"${t.col}"`;
        const alias = `"${t.newCol || `${t.func}_${t.col}`}"`;
        switch (t.func) {
          case 'UPPER': return `UPPER(${col}) AS ${alias}`;
          case 'LOWER': return `LOWER(${col}) AS ${alias}`;
          case 'TRIM':  return `TRIM(${col}) AS ${alias}`;
          case 'LENGTH': return `LENGTH(${col}) AS ${alias}`;
          case 'ABS':   return `ABS(${col}) AS ${alias}`;
          case 'CEIL':  return `CEIL(${col}) AS ${alias}`;
          case 'FLOOR': return `FLOOR(${col}) AS ${alias}`;
          case 'ROUND': return `ROUND(${col}, ${t.arg || 2}) AS ${alias}`;
          case 'CAST_INT':   return `CAST(${col} AS INTEGER) AS ${alias}`;
          case 'CAST_FLOAT': return `CAST(${col} AS FLOAT) AS ${alias}`;
          case 'CAST_TEXT':  return `CAST(${col} AS TEXT) AS ${alias}`;
          case 'COALESCE': return `COALESCE(${col}, ${t.arg ?? 0}) AS ${alias}`;
          case 'NULLIF':   return `NULLIF(${col}, ${t.arg ?? 0}) AS ${alias}`;
          default: return `${t.func}(${col}) AS ${alias}`;
        }
      }).join(', ');
      return `SELECT *, ${exprs} ${from}`;
    }

    default:
      return `SELECT * ${from}`;
  }
}

// ─────────────────────────────────────────────
//  Main Compiler
// ─────────────────────────────────────────────
export class SQLCompiler {
  compile(pipeline: Pipeline, grandma = false): CompileResult {
    const activeSteps = pipeline.steps.filter((s) => s.uiMeta.isActive);

    if (activeSteps.length === 0) {
      return {
        sql: '-- Нет активных шагов в пайплайне',
        humanSteps: [],
      };
    }

    try {
      const ctes: string[] = [];
      const humanSteps: string[] = [];

      activeSteps.forEach((step, i) => {
        const prevCTE = i === 0 ? '' : `step_${i - 1}`;
        const cteName = `step_${i}`;
        const body = buildStepSQL(step, prevCTE);
        ctes.push(`${cteName} AS (\n  ${body.replace(/\n/g, '\n  ')}\n)`);
        humanSteps.push(stepToHuman(step, grandma));
      });

      const lastCTE = `step_${activeSteps.length - 1}`;
      const sql = `WITH\n${ctes.join(',\n\n')}\n\nSELECT * FROM ${lastCTE}`;

      return { sql, humanSteps };
    } catch (e: any) {
      return {
        sql: '-- Ошибка компиляции',
        humanSteps: [],
        error: e?.message ?? String(e),
      };
    }
  }

  compileStep(step: Step, prevCTE = 'previous_step'): string {
    return buildStepSQL(step, prevCTE);
  }
}

export const compiler = new SQLCompiler();
export { parseFormula };
