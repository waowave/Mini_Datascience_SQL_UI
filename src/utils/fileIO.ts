/**
 * fileIO.ts — утилиты для импорта и экспорта данных
 *
 * Поддерживает:
 * - Сохранение/загрузка Pipeline (JSON)
 * - Экспорт результата в CSV
 * - Импорт CSV (через PapaParse)
 * - Импорт Excel .xlsx (через SheetJS/xlsx)
 */
import * as XLSX from 'xlsx';
import type { Pipeline, ColumnMeta, ColumnType, QueryResult } from '../types';

// ─────────────────────────────────────────────
//  Pipeline Save / Load
// ─────────────────────────────────────────────

export interface PipelineExport {
  version: 1;
  exportedAt: string;
  pipeline: Pipeline;
}

export function savePipelineToFile(pipeline: Pipeline): void {
  const data: PipelineExport = {
    version: 1,
    exportedAt: new Date().toISOString(),
    pipeline,
  };
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${pipeline.name.replace(/[^\w\-а-яё]/gi, '_')}.datasense.json`;
  a.click();
  URL.revokeObjectURL(url);
}

export function loadPipelineFromFile(): Promise<Pipeline> {
  return new Promise((resolve, reject) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json,.datasense.json';
    input.onchange = () => {
      const file = input.files?.[0];
      if (!file) { reject(new Error('Файл не выбран')); return; }
      const reader = new FileReader();
      reader.onload = (e) => {
        try {
          const text = e.target?.result as string;
          const data: PipelineExport = JSON.parse(text);
          if (data.version !== 1 || !data.pipeline) {
            reject(new Error('Неверный формат файла'));
            return;
          }
          resolve(data.pipeline);
        } catch {
          reject(new Error('Не удалось прочитать файл'));
        }
      };
      reader.onerror = () => reject(new Error('Ошибка чтения файла'));
      reader.readAsText(file);
    };
    input.click();
  });
}

// ─────────────────────────────────────────────
//  CSV Export
// ─────────────────────────────────────────────

export function exportResultToCSV(result: QueryResult, filename = 'export'): void {
  if (!result.rows.length) return;

  const headers = result.columns.map(c => c.name);
  const rows = result.rows.map(row =>
    headers.map(h => {
      const val = row[h];
      if (val === null || val === undefined) return '';
      const str = String(val);
      // Экранируем кавычки и оборачиваем если есть запятая/кавычка/перенос
      if (str.includes(',') || str.includes('"') || str.includes('\n')) {
        return `"${str.replace(/"/g, '""')}"`;
      }
      return str;
    }).join(',')
  );

  const csv = [headers.join(','), ...rows].join('\n');
  // BOM для корректного открытия в Excel на Windows
  const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${filename}_${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

// ─────────────────────────────────────────────
//  Excel Export
// ─────────────────────────────────────────────

export function exportResultToExcel(result: QueryResult, filename = 'export'): void {
  if (!result.rows.length) return;

  const headers = result.columns.map(c => c.name);
  const data = [
    headers,
    ...result.rows.map(row => headers.map(h => row[h] ?? '')),
  ];

  const ws = XLSX.utils.aoa_to_sheet(data);

  // Ширина колонок — автоматически по содержимому
  ws['!cols'] = headers.map((h) => {
    const maxLen = Math.max(
      h.length,
      ...result.rows.slice(0, 100).map(row => String(row[h] ?? '').length)
    );
    return { wch: Math.min(Math.max(maxLen + 2, 8), 40) };
  });

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Результат');
  XLSX.writeFile(wb, `${filename}_${new Date().toISOString().slice(0, 10)}.xlsx`);
}

// ─────────────────────────────────────────────
//  Excel Import
// ─────────────────────────────────────────────

export interface ImportResult {
  name: string;
  columns: ColumnMeta[];
  rows: Record<string, any>[];
}

function detectType(values: any[]): ColumnType {
  const nonEmpty = values.filter(v => v !== null && v !== undefined && v !== '');
  if (!nonEmpty.length) return 'text';

  let isInt = true;
  let isFloat = true;
  let isDate = true;

  for (const v of nonEmpty) {
    const str = String(v).trim();
    if (isInt && !/^-?\d+$/.test(str)) isInt = false;
    if (isFloat && !/^-?\d+(\.\d+)?$/.test(str)) isFloat = false;
    if (isDate) {
      // Проверяем форматы дат
      const d = new Date(str);
      if (isNaN(d.getTime()) && !/^\d{2}[.\-/]\d{2}[.\-/]\d{4}$/.test(str)) {
        isDate = false;
      }
    }
  }

  if (isInt) return 'integer';
  if (isFloat) return 'float';
  if (isDate) return 'date';
  return 'text';
}

function parseExcelFile(file: File): Promise<ImportResult[]> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
      reader.onload = (e) => {
        try {
          const data = new Uint8Array(e.target?.result as ArrayBuffer);
          const wb = XLSX.read(data, { type: 'array', cellDates: true });

          const results: ImportResult[] = wb.SheetNames.map(sheetName => {
            const ws = wb.Sheets[sheetName];
            // header: 1 — первая строка как заголовки
            const raw: any[][] = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null });

            if (!raw.length) {
              return { name: sheetName, columns: [], rows: [] };
            }

            // Первая строка — заголовки
            const headers = raw[0].map((h: any, i: number) =>
              h !== null && h !== undefined && String(h).trim() !== ''
                ? String(h).trim()
                : `Колонка_${i + 1}`
            );

            const dataRows = raw.slice(1).filter(row =>
              row.some(cell => cell !== null && cell !== undefined && cell !== '')
            );

            // Определяем типы
            const columns: ColumnMeta[] = headers.map((name: string, idx: number) => {
              const vals = dataRows.map(row => row[idx]);
              return { name, type: detectType(vals) };
            });

            // Конвертируем строки
            const rows: Record<string, any>[] = dataRows.map(row => {
              const obj: Record<string, any> = {};
              headers.forEach((h: string, i: number) => {
                let val = row[i];
                // Дата из Excel — объект Date
                if (val instanceof Date) {
                  val = val.toISOString().split('T')[0];
                } else if (val !== null && val !== undefined) {
                  val = String(val).trim() || null;
                  // Числа
                  const col = columns[i];
                  if (col.type === 'integer' && val !== null) val = parseInt(val);
                  else if (col.type === 'float' && val !== null) val = parseFloat(val);
                }
                obj[h] = val;
              });
              return obj;
            });

            return { name: sheetName, columns, rows };
          }).filter(r => r.columns.length > 0);

          resolve(results);
        } catch (err: any) {
          reject(new Error(`Ошибка импорта: ${err.message}`));
        }
      };
      reader.onerror = () => reject(new Error('Ошибка чтения файла'));
      reader.readAsArrayBuffer(file);
  });
}

/** Импорт Excel — принимает File напрямую или открывает file picker */
export function importExcelFile(file?: File): Promise<ImportResult[]> {
  if (file) return parseExcelFile(file);
  return new Promise((resolve, reject) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.xlsx,.xls,.ods';
    input.onchange = () => {
      const f = input.files?.[0];
      if (!f) { reject(new Error('Файл не выбран')); return; }
      parseExcelFile(f).then(resolve).catch(reject);
    };
    input.click();
  });
}

export function importCSVFile(): Promise<ImportResult> {
  return new Promise((resolve, reject) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.csv,.tsv,.txt';
    input.onchange = () => {
      const file = input.files?.[0];
      if (!file) { reject(new Error('Файл не выбран')); return; }

      const reader = new FileReader();
      reader.onload = (e) => {
        try {
          const text = e.target?.result as string;

          // Определяем разделитель
          const firstLine = text.split('\n')[0];
          const delimiter = firstLine.includes('\t') ? '\t'
            : firstLine.includes(';') ? ';'
            : ',';

          // Парсим CSV вручную (без зависимостей)
          const lines = text.split('\n').filter(l => l.trim());
          if (!lines.length) {
            reject(new Error('Файл пуст'));
            return;
          }

          const parseCSVLine = (line: string): string[] => {
            const result: string[] = [];
            let current = '';
            let inQuotes = false;
            for (let i = 0; i < line.length; i++) {
              const ch = line[i];
              if (ch === '"') {
                if (inQuotes && line[i + 1] === '"') { current += '"'; i++; }
                else inQuotes = !inQuotes;
              } else if (ch === delimiter && !inQuotes) {
                result.push(current.trim());
                current = '';
              } else {
                current += ch;
              }
            }
            result.push(current.trim());
            return result;
          };

          const headers = parseCSVLine(lines[0]);
          const dataRows = lines.slice(1).map(parseCSVLine);

          const columns: ColumnMeta[] = headers.map((name, i) => ({
            name: name || `Колонка_${i + 1}`,
            type: detectType(dataRows.map(r => r[i])),
          }));

          const rows: Record<string, any>[] = dataRows.map(row => {
            const obj: Record<string, any> = {};
            headers.forEach((h, i) => {
              const val = row[i];
              const col = columns[i];
              if (val === '' || val === undefined) { obj[h] = null; return; }
              if (col.type === 'integer') obj[h] = parseInt(val);
              else if (col.type === 'float') obj[h] = parseFloat(val);
              else obj[h] = val;
            });
            return obj;
          });

          resolve({
            name: file.name.replace(/\.[^/.]+$/, ''),
            columns,
            rows,
          });
        } catch (err: any) {
          reject(new Error(`Ошибка: ${err.message}`));
        }
      };
      reader.readAsText(file, 'UTF-8');
    };
    input.click();
  });
}
