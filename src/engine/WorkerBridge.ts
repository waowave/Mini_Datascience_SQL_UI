/**
 * WorkerBridge — запускает executor в Web Worker через Blob URL.
 * Совместимо с viteSingleFile (inline bundle).
 * 
 * Весь код воркера встраивается как строка и запускается через URL.createObjectURL.
 */

import type { Pipeline, TableMetadata, QueryResult, ColumnMeta, ColumnType } from '../types';

// ─────────────────────────────────────────────────────────────────
//  Весь код воркера как строка (self-contained)
// ─────────────────────────────────────────────────────────────────
const WORKER_CODE = /* js */ `
'use strict';

function inferType(value) {
  if (value === null || value === undefined) return 'unknown';
  if (typeof value === 'boolean') return 'boolean';
  if (typeof value === 'number') return Number.isInteger(value) ? 'integer' : 'float';
  if (typeof value === 'string') {
    if (value.trim() !== '' && !isNaN(Number(value))) {
      return value.includes('.') ? 'float' : 'integer';
    }
    if (/^\\d{4}-\\d{2}-\\d{2}/.test(value)) return 'date';
    return 'text';
  }
  return 'unknown';
}

function inferColumns(rows) {
  if (rows.length === 0) return [];
  return Object.keys(rows[0]).map(function(name) {
    return { name: name, type: inferType(rows[0][name]) };
  });
}

function evalFormula(expr, row) {
  var code = expr.replace(/\\[([^\\]]+)\\]/g, function(_, col) {
    var val = row[col];
    if (val === null || val === undefined) return '0';
    if (typeof val === 'string') return JSON.stringify(val);
    return String(val);
  });
  code = code
    .replace(/ОКРУГЛ\\s*\\(([^,]+),\\s*(\\d+)\\)/gi, 'Math.round(($1)*Math.pow(10,$2))/Math.pow(10,$2)')
    .replace(/ABS\\s*\\(/gi, 'Math.abs(')
    .replace(/SQRT\\s*\\(/gi, 'Math.sqrt(')
    .replace(/МАКС\\s*\\(/gi, 'Math.max(')
    .replace(/МИН\\s*\\(/gi, 'Math.min(');
  try {
    return new Function('Math', 'return ' + code)(Math);
  } catch(e) {
    return null;
  }
}

function matchCondition(row, col, op, val) {
  var cellRaw = row[col];
  var cell = (cellRaw !== null && cellRaw !== undefined) ? cellRaw : '';
  switch (op) {
    case '=':          return String(cell) === String(val);
    case '!=':         return String(cell) !== String(val);
    case '>':          return Number(cell) > Number(val);
    case '>=':         return Number(cell) >= Number(val);
    case '<':          return Number(cell) < Number(val);
    case '<=':         return Number(cell) <= Number(val);
    case 'LIKE':       return String(cell).toLowerCase().indexOf(String(val).toLowerCase()) !== -1;
    case 'NOT LIKE':   return String(cell).toLowerCase().indexOf(String(val).toLowerCase()) === -1;
    case 'IS NULL':    return cellRaw === null || cellRaw === undefined || cellRaw === '';
    case 'IS NOT NULL':return cellRaw !== null && cellRaw !== undefined && cellRaw !== '';
    case 'IN': {
      var list = Array.isArray(val) ? val : String(val).split(',').map(function(s){ return s.trim(); });
      return list.indexOf(String(cell)) !== -1;
    }
    default: return true;
  }
}

function applyStep(step, rows, allSources) {
  var type = step.type;
  var params = step.params;

  if (type === 'FROM') {
    var src = null;
    for (var i = 0; i < allSources.length; i++) {
      if (allSources[i].id === params.tableId || allSources[i].name === params.tableName) {
        src = allSources[i]; break;
      }
    }
    if (!src) return [];
    return src.rows.map(function(r) { return Object.assign({}, r); });
  }

  if (type === 'FILTER') {
    if (!params.conditions || params.conditions.length === 0) return rows;
    return rows.filter(function(row) {
      var result = true;
      for (var i = 0; i < params.conditions.length; i++) {
        var c = params.conditions[i];
        var match = matchCondition(row, c.col, c.op, c.val);
        if (i === 0) { result = match; }
        else { result = c.conjunction === 'OR' ? result || match : result && match; }
      }
      return result;
    });
  }

  if (type === 'JOIN') {
    var j = params.join;
    var rightSrc = null;
    for (var i = 0; i < allSources.length; i++) {
      if (allSources[i].id === j.targetTable || allSources[i].name === j.targetTableName) {
        rightSrc = allSources[i]; break;
      }
    }
    if (!rightSrc) return rows;
    var rightRows = rightSrc.rows;
    var rightIndex = new Map();
    for (var i = 0; i < rightRows.length; i++) {
      var key = String(rightRows[i][j.on[1]] !== null && rightRows[i][j.on[1]] !== undefined ? rightRows[i][j.on[1]] : '');
      if (!rightIndex.has(key)) rightIndex.set(key, []);
      rightIndex.get(key).push(rightRows[i]);
    }
    var result = [];
    if (j.type === 'inner') {
      for (var i = 0; i < rows.length; i++) {
        var matches = rightIndex.get(String(rows[i][j.on[0]] !== null && rows[i][j.on[0]] !== undefined ? rows[i][j.on[0]] : '')) || [];
        for (var k = 0; k < matches.length; k++) result.push(Object.assign({}, rows[i], matches[k]));
      }
    } else {
      var emptyRight = {};
      if (rightRows[0]) Object.keys(rightRows[0]).forEach(function(k) { emptyRight[k] = null; });
      for (var i = 0; i < rows.length; i++) {
        var matches = rightIndex.get(String(rows[i][j.on[0]] !== null && rows[i][j.on[0]] !== undefined ? rows[i][j.on[0]] : '')) || [];
        if (matches.length === 0) { result.push(Object.assign({}, rows[i], emptyRight)); }
        else { for (var k = 0; k < matches.length; k++) result.push(Object.assign({}, rows[i], matches[k])); }
      }
    }
    return result;
  }

  if (type === 'FORMULA') {
    var f = params.formula;
    return rows.map(function(row) {
      var newRow = Object.assign({}, row);
      newRow[f.newCol] = evalFormula(f.expr, row);
      return newRow;
    });
  }

  if (type === 'GROUP') {
    var a = params.aggregate;
    var groups = a.groups;
    var grouped = new Map();
    for (var i = 0; i < rows.length; i++) {
      var key = groups.map(function(g) { return String(rows[i][g] !== null && rows[i][g] !== undefined ? rows[i][g] : ''); }).join('\\x00');
      if (!grouped.has(key)) grouped.set(key, []);
      grouped.get(key).push(rows[i]);
    }
    var result = [];
    grouped.forEach(function(groupRows, key) {
      var newRow = {};
      var keyParts = key.split('\\x00');
      groups.forEach(function(g, i) { newRow[g] = keyParts[i]; });
      a.aggs.forEach(function(ag) {
        var alias = ag.alias || (ag.func.replace(' ', '_') + '_' + ag.col);
        var vals = groupRows.map(function(r) { return r[ag.col]; }).filter(function(v) { return v !== null && v !== undefined; });
        var nums = vals.map(Number);
        if (ag.func === 'SUM') newRow[alias] = nums.reduce(function(a,b){return a+b;},0);
        else if (ag.func === 'AVG') newRow[alias] = nums.length ? nums.reduce(function(a,b){return a+b;},0)/nums.length : 0;
        else if (ag.func === 'COUNT') newRow[alias] = groupRows.length;
        else if (ag.func === 'COUNT DISTINCT') newRow[alias] = new Set(vals.map(String)).size;
        else if (ag.func === 'MIN') newRow[alias] = nums.length ? Math.min.apply(null,nums) : null;
        else if (ag.func === 'MAX') newRow[alias] = nums.length ? Math.max.apply(null,nums) : null;
      });
      result.push(newRow);
    });
    return result;
  }

  if (type === 'SORT') {
    var s = params.sort;
    return rows.slice().sort(function(a, b) {
      for (var i = 0; i < s.sorts.length; i++) {
        var col = s.sorts[i].col, dir = s.sorts[i].dir;
        var av = a[col], bv = b[col];
        var cmp = (typeof av === 'number' && typeof bv === 'number')
          ? av - bv
          : String(av !== null && av !== undefined ? av : '').localeCompare(String(bv !== null && bv !== undefined ? bv : ''), 'ru');
        if (cmp !== 0) return dir === 'ASC' ? cmp : -cmp;
      }
      return 0;
    });
  }

  if (type === 'RENAME') {
    var r = params.rename;
    return rows.map(function(row) {
      var newRow = Object.assign({}, row);
      r.renames.forEach(function(x) {
        if (x.from in newRow) {
          newRow[x.to] = newRow[x.from];
          delete newRow[x.from];
        }
      });
      return newRow;
    });
  }

  if (type === 'TRANSFORM') {
    var ts = params.transforms || [];
    if (ts.length === 0) return rows;
    return rows.map(function(row) {
      var newRow = Object.assign({}, row);
      ts.forEach(function(t) {
        var col = t.col;
        var val = row[col];
        var alias = t.newCol || (t.func + '_' + col);
        var strVal = val !== null && val !== undefined ? String(val) : '';
        var numVal = Number(val);
        switch (t.func) {
          case 'UPPER':      newRow[alias] = strVal.toUpperCase(); break;
          case 'LOWER':      newRow[alias] = strVal.toLowerCase(); break;
          case 'TRIM':       newRow[alias] = strVal.trim(); break;
          case 'LENGTH':     newRow[alias] = strVal.length; break;
          case 'ABS':        newRow[alias] = Math.abs(numVal); break;
          case 'CEIL':       newRow[alias] = Math.ceil(numVal); break;
          case 'FLOOR':      newRow[alias] = Math.floor(numVal); break;
          case 'ROUND':      var digits = parseInt(t.arg) || 0; newRow[alias] = parseFloat(numVal.toFixed(digits)); break;
          case 'CAST_INT':   newRow[alias] = parseInt(strVal) || 0; break;
          case 'CAST_FLOAT': newRow[alias] = parseFloat(strVal) || 0; break;
          case 'CAST_TEXT':  newRow[alias] = strVal; break;
          case 'COALESCE':   newRow[alias] = (val !== null && val !== undefined && strVal !== '') ? val : (t.arg !== undefined ? t.arg : null); break;
          case 'NULLIF':     newRow[alias] = (strVal === String(t.arg)) ? null : val; break;
          default:           newRow[alias] = val; break;
        }
      });
      return newRow;
    });
  }

  if (type === 'LIMIT') {
    var offset = params.offset || 0;
    var limit = params.limit || 100;
    return rows.slice(offset, offset + limit);
  }

  if (type === 'SELECT') {
    var cols = (params.select && params.select.columns) ? params.select.columns : [];
    if (cols.length === 0) return rows;
    return rows.map(function(row) {
      var newRow = {};
      cols.forEach(function(c) { newRow[c] = row[c]; });
      return newRow;
    });
  }

  return rows;
}

function runPipeline(pipeline, allSources, page, pageSize, upToStepIndex) {
  var start = performance.now();
  var stepsRaw = (upToStepIndex !== undefined && upToStepIndex !== null)
    ? pipeline.steps.slice(0, upToStepIndex + 1)
    : pipeline.steps;
  var activeSteps = stepsRaw.filter(function(s) { return s.uiMeta.isActive; });

  if (activeSteps.length === 0) {
    return { columns: [], rows: [], totalRows: 0, executionTime: 0 };
  }
  try {
    var rows = [];
    for (var i = 0; i < activeSteps.length; i++) {
      rows = applyStep(activeSteps[i], rows, allSources);
    }
    var totalRows = rows.length;
    var pageRows = rows.slice(page * pageSize, (page + 1) * pageSize);
    var sampleRows = pageRows.length > 0 ? pageRows : rows.slice(0, 1);
    var columns = inferColumns(sampleRows);
    return {
      columns: columns,
      rows: pageRows,
      totalRows: totalRows,
      executionTime: performance.now() - start
    };
  } catch(e) {
    return {
      columns: [], rows: [], totalRows: 0,
      executionTime: performance.now() - start,
      error: e && e.message ? e.message : String(e)
    };
  }
}

self.onmessage = function(e) {
  var data = e.data;
  var result = runPipeline(data.pipeline, data.sources, data.page || 0, data.pageSize || 500, data.upToStepIndex);
  self.postMessage({ id: data.id, result: result });
};
`;

// ─────────────────────────────────────────────────────────────────
//  WorkerBridge singleton
// ─────────────────────────────────────────────────────────────────
class WorkerBridge {
  private worker: Worker | null = null;
  private pending: Map<number, { resolve: (r: QueryResult) => void; reject: (e: Error) => void }> = new Map();
  private counter = 0;

  private getWorker(): Worker {
    if (this.worker) return this.worker;
    const blob = new Blob([WORKER_CODE], { type: 'application/javascript' });
    const url = URL.createObjectURL(blob);
    this.worker = new Worker(url);
    URL.revokeObjectURL(url); // можно отозвать сразу после создания

    this.worker.onmessage = (e: MessageEvent) => {
      const { id, result } = e.data;
      const p = this.pending.get(id);
      if (p) {
        this.pending.delete(id);
        p.resolve(result as QueryResult);
      }
    };

    this.worker.onerror = (e: ErrorEvent) => {
      this.pending.forEach((p) => p.reject(new Error(e.message)));
      this.pending.clear();
      this.worker = null; // пересоздастся при следующем запросе
    };

    return this.worker;
  }

  execute(
    pipeline: Pipeline,
    sources: TableMetadata[],
    options: { page?: number; pageSize?: number; upToStepIndex?: number } = {}
  ): Promise<QueryResult> {
    const id = ++this.counter;
    return new Promise<QueryResult>((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      // Сериализуем только нужные поля sources (без лишних ссылок)
      const lightSources = sources.map((s) => ({
        id: s.id,
        name: s.name,
        columns: s.columns,
        rows: s.rows,
        rowCount: s.rowCount,
        sourceType: s.sourceType,
      }));
      this.getWorker().postMessage({
        id,
        pipeline,
        sources: lightSources,
        page: options.page ?? 0,
        pageSize: options.pageSize ?? 500,
        upToStepIndex: options.upToStepIndex ?? null,
      });
    });
  }
}

export const workerBridge = new WorkerBridge();

// Типы для использования в worker (не используются в рантайме, только для TS)
export type { Pipeline, TableMetadata, QueryResult, ColumnMeta, ColumnType };
