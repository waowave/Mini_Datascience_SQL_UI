import { useCallback, useRef, useState } from 'react';
import { v4 as uuid } from 'uuid';
import {
  Database, Table2, ChevronRight, ChevronDown,
  Trash2, Plus, Hash, Type, Calendar, Eye, Layers, Pencil,
  FileSpreadsheet, FileText, Upload,
} from 'lucide-react';
import { useStore } from '../store/useStore';
import { TablePreviewModal } from './TablePreviewModal';
import { TableEditor } from './TableEditor';
import type { TableMetadata, ColumnType, ColumnMeta } from '../types';
import { importExcelFile } from '../utils/fileIO';

// ─── Type inference ───────────────────────────────────────────────
function inferType(values: any[]): ColumnType {
  const nonEmpty = values.filter(v => v !== '' && v !== null && v !== undefined);
  if (nonEmpty.length === 0) return 'text';
  if (nonEmpty.every(v => !isNaN(Number(v))))
    return nonEmpty.every(v => Number.isInteger(Number(v))) ? 'integer' : 'float';
  if (nonEmpty.every(v => /^\d{4}-\d{2}-\d{2}/.test(String(v)))) return 'date';
  return 'text';
}

// ─── Type badge ───────────────────────────────────────────────────
function TypeBadge({ type }: { type: ColumnType }) {
  const map: Record<string, { label: string; cls: string; Icon: any }> = {
    integer: { label: 'INT',  cls: 'text-blue-400',   Icon: Hash },
    float:   { label: 'DEC',  cls: 'text-blue-300',   Icon: Hash },
    date:    { label: 'DATE', cls: 'text-green-400',  Icon: Calendar },
    text:    { label: 'TEXT', cls: 'text-slate-400',  Icon: Type },
    boolean: { label: 'BOOL', cls: 'text-purple-400', Icon: Hash },
    unknown: { label: '?',    cls: 'text-slate-600',  Icon: Hash },
  };
  const { label, cls, Icon } = map[type] ?? map.unknown;
  return (
    <span className={`flex items-center gap-0.5 text-[9px] font-mono ${cls}`}>
      <Icon size={8} />
      {label}
    </span>
  );
}

function sourceTypeBadge(t: string) {
  if (t === 'virtual') return { label: 'Вирт.', cls: 'bg-purple-500/20 text-purple-400' };
  if (t === 'csv')     return { label: 'CSV',   cls: 'bg-green-500/20  text-green-400'  };
  if (t === 'xlsx')    return { label: 'Excel', cls: 'bg-emerald-500/20 text-emerald-400' };
  if (t === 'demo')    return { label: 'Demo',  cls: 'bg-blue-500/20   text-blue-400'   };
  return { label: 'Ручная', cls: 'bg-slate-500/20 text-slate-400' };
}

// ─── TableItem ────────────────────────────────────────────────────
interface TableItemProps {
  table: TableMetadata;
  onUse: () => void;
  onPreview: () => void;
  onEdit: () => void;
}

function TableItem({ table, onUse, onPreview, onEdit }: TableItemProps) {
  const { removeSource } = useStore();
  const [expanded, setExpanded] = useState(false);
  const { label, cls } = sourceTypeBadge(table.sourceType);

  return (
    <div className="mb-0.5">
      <div
        className="flex items-center gap-1.5 px-2 py-1.5 rounded-lg hover:bg-slate-700/60 cursor-pointer group transition-colors"
        onClick={() => setExpanded(!expanded)}
      >
        <button
          className="text-slate-500 flex-shrink-0"
          onClick={(e) => { e.stopPropagation(); setExpanded(!expanded); }}
        >
          {expanded ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
        </button>

        {table.sourceType === 'virtual' ? (
          <Layers size={12} className="text-purple-400 flex-shrink-0" />
        ) : (
          <Table2 size={12} className="text-blue-400 flex-shrink-0" />
        )}

        <span className="text-xs text-slate-200 flex-1 truncate font-medium">{table.name}</span>
        <span className={`text-[9px] px-1.5 py-0.5 rounded-full font-medium flex-shrink-0 ${cls}`}>{label}</span>

        {/* Hover actions */}
        <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
          <button
            className="p-1 text-slate-400 hover:text-blue-300 transition-colors"
            title="Предпросмотр"
            onClick={(e) => { e.stopPropagation(); onPreview(); }}
          >
            <Eye size={11} />
          </button>
          <button
            className="p-1 text-slate-400 hover:text-amber-300 transition-colors"
            title="Редактировать таблицу"
            onClick={(e) => { e.stopPropagation(); onEdit(); }}
          >
            <Pencil size={11} />
          </button>
          <button
            className="p-1 text-blue-400 hover:text-blue-300 transition-colors"
            title="Использовать в пайплайне"
            onClick={(e) => { e.stopPropagation(); onUse(); }}
          >
            <Plus size={11} />
          </button>
          {table.sourceType !== 'demo' && (
            <button
              className="p-1 text-red-400 hover:text-red-300 transition-colors"
              onClick={(e) => { e.stopPropagation(); removeSource(table.id); }}
              title="Удалить"
            >
              <Trash2 size={11} />
            </button>
          )}
        </div>
      </div>

      {/* Column list */}
      {expanded && (
        <div className="ml-5 border-l border-slate-700/50 pl-2 py-0.5">
          <div className="text-[10px] text-slate-600 px-1 mb-1">
            {(table.rowCount ?? table.rows.length).toLocaleString('ru-RU')} строк ·{' '}
            {table.columns.length} колонок
          </div>
          {table.columns.map((col) => (
            <div key={col.name} className="flex items-center gap-2 py-0.5 px-1">
              <TypeBadge type={col.type} />
              <span className="text-[11px] text-slate-400 truncate">{col.name}</span>
            </div>
          ))}
          <div className="flex gap-2 mt-1.5 pt-1 border-t border-slate-700/30">
            <button
              className="text-[11px] text-blue-400 hover:text-blue-300 transition-colors"
              onClick={onPreview}
            >
              👁 Просмотр
            </button>
            <button
              className="text-[11px] text-amber-400 hover:text-amber-300 transition-colors"
              onClick={onEdit}
            >
              ✏️ Изменить
            </button>
            <button
              className="text-[11px] text-green-400 hover:text-green-300 transition-colors"
              onClick={onUse}
            >
              ▶ В пайплайн
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── SourcePanel ──────────────────────────────────────────────────
export function SourcePanel() {
  const { sources, addSource, addStep, pipelines, activeTabId, grandmaMode } = useStore();

  const csvInputRef  = useRef<HTMLInputElement>(null);
  const [importing, setImporting]         = useState(false);
  const [importProgress, setImportProgress] = useState('');
  const [dragOver, setDragOver]           = useState(false);
  const [previewTable, setPreviewTable]   = useState<TableMetadata | null>(null);
  const [editTableId, setEditTableId]     = useState<string | null>(null);
  const [notification, setNotification]   = useState<string | null>(null);

  const notify = (msg: string) => {
    setNotification(msg);
    setTimeout(() => setNotification(null), 3000);
  };

  // ── Parse raw CSV rows → TableMetadata ──────────────────────────
  const buildSourceFromRows = (
    name: string,
    headers: string[],
    raw: Record<string, any>[],
    sourceType: 'csv' | 'xlsx' = 'csv',
  ): TableMetadata => {
    const columns: ColumnMeta[] = headers.map((h) => ({
      name: h,
      type: inferType(raw.slice(0, 200).map((r) => r[h])),
    }));
    const rows = raw.map((row) => {
      const r: Record<string, any> = {};
      columns.forEach((col) => {
        const v = row[col.name];
        if (col.type === 'integer') r[col.name] = v === '' || v == null ? null : parseInt(v, 10);
        else if (col.type === 'float') r[col.name] = v === '' || v == null ? null : parseFloat(v);
        else r[col.name] = v === '' || v == null ? null : v;
      });
      return r;
    });
    return { id: uuid(), name, sourceType, columns, rows, rowCount: rows.length };
  };

  // ── CSV via PapaParse (worker) ───────────────────────────────────
  const handleCSVFile = useCallback((file: File) => {
    setImporting(true);
    setImportProgress('Читаем CSV...');
    import('papaparse').then(({ default: Papa }) => {
      Papa.parse(file, {
        header: true,
        skipEmptyLines: true,
        dynamicTyping: false,
        worker: true,
        complete: (results) => {
          const raw = results.data as Record<string, any>[];
          const headers = results.meta.fields ?? [];
          const table = buildSourceFromRows(
            file.name.replace(/\.(csv|tsv)$/i, ''),
            headers,
            raw,
            'csv',
          );
          addSource(table);
          setImporting(false);
          setImportProgress('');
          notify(`✓ Импортирован "${table.name}" — ${raw.length.toLocaleString('ru-RU')} строк`);
        },
        error: (err: any) => {
          notify(`✗ Ошибка CSV: ${err.message}`);
          setImporting(false);
          setImportProgress('');
        },
      });
    });
  }, [addSource]);

  // ── Excel via fileIO util ────────────────────────────────────────
  const handleExcelFile = useCallback(async (file: File) => {
    setImporting(true);
    setImportProgress('Читаем Excel...');
    try {
      // Pass File object directly via DataTransfer trick
      const sheets = await importExcelFile(file);
      for (const sheet of sheets) {
        const table: TableMetadata = {
          id: uuid(),
          name: sheet.name,
          sourceType: 'xlsx' as any,
          columns: sheet.columns,
          rows: sheet.rows,
          rowCount: sheet.rows.length,
        };
        addSource(table);
      }
      const names = sheets.map((s) => `"${s.name}"`).join(', ');
      notify(`✓ Excel импортирован: ${names}`);
    } catch (err: any) {
      notify(`✗ ${err.message}`);
    }
    setImporting(false);
    setImportProgress('');
  }, [addSource]);

  // ── Route file by extension ──────────────────────────────────────
  const handleFile = useCallback((file: File) => {
    const ext = file.name.split('.').pop()?.toLowerCase();
    if (ext === 'csv' || ext === 'tsv') handleCSVFile(file);
    else if (ext === 'xlsx' || ext === 'xls' || ext === 'ods') handleExcelFile(file);
    else notify('✗ Поддерживаются: CSV, TSV, XLSX, XLS, ODS');
  }, [handleCSVFile, handleExcelFile]);

  // ── Drag & drop ──────────────────────────────────────────────────
  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
  }, [handleFile]);

  // ── File input change ────────────────────────────────────────────
  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) handleFile(file);
    e.target.value = '';
  };

  // ── Use table in pipeline ────────────────────────────────────────
  const useTableInPipeline = (table: TableMetadata) => {
    const pipeline = pipelines.find((p) => p.id === activeTabId);
    if (!pipeline) return;
    const existingFrom = pipeline.steps.find((s) => s.type === 'FROM');
    if (existingFrom) {
      useStore.getState().updateStep(activeTabId, existingFrom.id, {
        params: { tableId: table.id, tableName: table.name },
      });
    } else {
      addStep(activeTabId, {
        type: 'FROM',
        params: { tableId: table.id, tableName: table.name },
        uiMeta: { isCollapsed: false, comment: '', isActive: true },
      });
    }
  };

  // ── Create blank table ───────────────────────────────────────────
  const createBlankTable = () => {
    const table: TableMetadata = {
      id: uuid(),
      name: `Таблица_${sources.length + 1}`,
      sourceType: 'manual',
      columns: [
        { name: 'id',       type: 'integer' },
        { name: 'Название', type: 'text'    },
        { name: 'Значение', type: 'float'   },
      ],
      rows: [{ id: 1, Название: '', Значение: null }],
      rowCount: 1,
    };
    addSource(table);
    setEditTableId(table.id);
  };

  // ── Group sources ────────────────────────────────────────────────
  const demoTables     = sources.filter((s) => s.sourceType === 'demo');
  const importedTables = sources.filter((s) => ['csv', 'xlsx', 'manual'].includes(s.sourceType));
  const virtualTables  = sources.filter((s) => s.sourceType === 'virtual');

  const renderGroup = (
    label: string,
    tables: TableMetadata[],
    icon?: React.ReactNode,
  ) => {
    if (tables.length === 0) return null;
    return (
      <div className="mb-2">
        <div className="flex items-center gap-1.5 px-2 py-1 mb-0.5">
          {icon}
          <p className="text-[10px] text-slate-500 uppercase tracking-wider font-semibold">{label}</p>
        </div>
        {tables.map((table) => (
          <TableItem
            key={table.id}
            table={table}
            onUse={() => useTableInPipeline(table)}
            onPreview={() => setPreviewTable(table)}
            onEdit={() => setEditTableId(table.id)}
          />
        ))}
      </div>
    );
  };

  return (
    <div className="flex flex-col h-full bg-slate-900">
      {/* Header */}
      <div className="p-3 border-b border-slate-700 flex items-center gap-2 flex-shrink-0">
        <Database size={15} className="text-slate-400" />
        <span className="text-sm font-semibold text-slate-200">
          {grandmaMode ? 'Мои таблицы' : 'Data Sources'}
        </span>
        <span className="text-xs text-slate-500 ml-auto">{sources.length}</span>
      </div>

      {/* Import drop zone — CSV + Excel + TSV */}
      <div
        className={`mx-2 mt-2 mb-1 border-2 border-dashed rounded-xl transition-all cursor-pointer flex-shrink-0 ${
          dragOver
            ? 'border-blue-400 bg-blue-500/10'
            : 'border-slate-700 hover:border-blue-500/50 hover:bg-slate-800/40'
        }`}
        onDrop={handleDrop}
        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onClick={() => csvInputRef.current?.click()}
      >
        {/* Hidden file input — accept all supported formats */}
        <input
          ref={csvInputRef}
          type="file"
          accept=".csv,.tsv,.xlsx,.xls,.ods"
          className="hidden"
          onChange={handleInputChange}
        />

        {importing ? (
          <div className="p-3 text-center">
            <div className="w-4 h-4 border-2 border-blue-500 border-t-transparent rounded-full animate-spin mx-auto mb-1" />
            <p className="text-xs text-slate-400">{importProgress}</p>
          </div>
        ) : (
          <div className="p-3">
            <div className="flex items-center justify-center gap-2 mb-1.5">
              <Upload size={13} className={`transition-colors ${dragOver ? 'text-blue-400' : 'text-slate-500'}`} />
              <span className={`text-xs font-medium transition-colors ${dragOver ? 'text-blue-300' : 'text-slate-400'}`}>
                {grandmaMode ? 'Открыть файл таблицы' : 'Импорт данных'}
              </span>
            </div>
            {/* Format badges */}
            <div className="flex items-center justify-center gap-1.5 flex-wrap">
              <span className="flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded bg-slate-800 text-slate-400 border border-slate-700">
                <FileText size={9} className="text-blue-400" /> CSV
              </span>
              <span className="flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded bg-slate-800 text-slate-400 border border-slate-700">
                <FileText size={9} className="text-blue-300" /> TSV
              </span>
              <span className="flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded bg-slate-800 text-slate-400 border border-slate-700">
                <FileSpreadsheet size={9} className="text-green-400" /> XLSX
              </span>
              <span className="flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded bg-slate-800 text-slate-400 border border-slate-700">
                <FileSpreadsheet size={9} className="text-emerald-400" /> XLS
              </span>
            </div>
            <p className="text-[10px] text-slate-600 text-center mt-1.5">
              Перетащите или кликните для выбора
            </p>
          </div>
        )}
      </div>

      {/* Create blank table */}
      <button
        onClick={createBlankTable}
        className="mx-2 mb-2 flex items-center justify-center gap-1.5 px-3 py-1.5 text-xs text-slate-400 hover:text-green-300 hover:bg-green-500/10 border border-slate-700 hover:border-green-500/40 rounded-lg transition-colors flex-shrink-0"
      >
        <Plus size={11} />
        {grandmaMode ? 'Создать пустую таблицу' : 'New blank table'}
      </button>

      {/* Tables list */}
      <div className="flex-1 overflow-y-auto px-1 custom-scroll min-h-0">
        {sources.length === 0 ? (
          <div className="text-center p-6">
            <Database size={28} className="text-slate-700 mx-auto mb-2" />
            <p className="text-xs text-slate-600">
              {grandmaMode
                ? 'Загрузите файл или создайте таблицу'
                : 'No sources yet. Import a file or create a table.'}
            </p>
          </div>
        ) : (
          <>
            {renderGroup('Демо данные', demoTables,
              <Database size={10} className="text-blue-400" />)}
            {renderGroup(grandmaMode ? 'Загруженные файлы' : 'Imported', importedTables,
              <Upload size={10} className="text-green-400" />)}
            {renderGroup(grandmaMode ? 'Виртуальные таблицы' : 'Virtual tables', virtualTables,
              <Layers size={10} className="text-purple-400" />)}
          </>
        )}
      </div>

      {/* Virtual table hint */}
      {virtualTables.length === 0 && sources.length > 0 && (
        <div className="px-2 pb-2 flex-shrink-0">
          <div className="bg-slate-800/60 border border-slate-700/40 rounded-lg p-2 text-center">
            <Layers size={12} className="text-slate-600 mx-auto mb-1" />
            <p className="text-[10px] text-slate-600 leading-tight">
              {grandmaMode
                ? 'Результат пайплайна можно сохранить как виртуальную таблицу для использования в JOIN'
                : 'Save pipeline result as virtual table for use in JOINs'}
            </p>
          </div>
        </div>
      )}

      {/* Notification */}
      {notification && (
        <div className="mx-2 mb-2 px-3 py-2 bg-slate-700 border border-slate-600 rounded-lg text-xs text-slate-200 flex-shrink-0">
          {notification}
        </div>
      )}

      {/* Preview Modal */}
      {previewTable && (
        <TablePreviewModal
          table={previewTable}
          onClose={() => setPreviewTable(null)}
          onUseInPipeline={() => useTableInPipeline(previewTable)}
        />
      )}

      {/* Table Editor Modal */}
      {editTableId && (
        <TableEditor
          tableId={editTableId}
          onClose={() => setEditTableId(null)}
        />
      )}
    </div>
  );
}
