import { useState, useEffect } from 'react';
import {
  DndContext, closestCenter, KeyboardSensor,
  PointerSensor, useSensor, useSensors, DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext, sortableKeyboardCoordinates, verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import {
  Play, Code2, Database, Filter, Sigma,
  ArrowUpDown, Pencil, Scissors, Link2, Eye, Sparkles, Save,
  FolderOpen, Layers, Wand2,
} from 'lucide-react';
import { v4 as uuid } from 'uuid';
import { useStore } from '../store/useStore';
import { StepCard } from './StepCard';
import { StepEditor } from './StepEditor';
import { compiler } from '../engine/SQLCompiler';
import {
  savePipelineToFile,
  loadPipelineFromFile,
} from '../utils/fileIO';
import type { Step, StepType } from '../types';

const ADD_STEP_OPTIONS: {
  type: StepType; label: string; grandmaLabel: string;
  icon: any; color: string;
}[] = [
  { type: 'FILTER',    label: 'Фильтр',          grandmaLabel: 'Отбор строк',       icon: Filter,     color: 'text-amber-400'  },
  { type: 'JOIN',      label: 'JOIN',             grandmaLabel: 'Приклеить таблицу', icon: Link2,      color: 'text-purple-400' },
  { type: 'FORMULA',   label: 'Формула',          grandmaLabel: 'Новая колонка',     icon: Sparkles,   color: 'text-green-400'  },
  { type: 'GROUP',     label: 'GROUP BY',         grandmaLabel: 'Сводка (Итого)',    icon: Sigma,      color: 'text-rose-400'   },
  { type: 'TRANSFORM', label: 'Преобразование',   grandmaLabel: 'Изменить значения', icon: Wand2,      color: 'text-purple-400' },
  { type: 'SORT',      label: 'Сортировка',       grandmaLabel: 'Сортировка',        icon: ArrowUpDown, color: 'text-cyan-400'  },
  { type: 'RENAME',    label: 'Переименовать',    grandmaLabel: 'Переименовать',     icon: Pencil,     color: 'text-orange-400' },
  { type: 'LIMIT',     label: 'Лимит строк',      grandmaLabel: 'Ограничить',        icon: Scissors,   color: 'text-slate-400'  },
  { type: 'SELECT',    label: 'Выбрать колонки',  grandmaLabel: 'Выбрать колонки',  icon: Eye,        color: 'text-indigo-400' },
];

function defaultParams(type: StepType): any {
  switch (type) {
    case 'FILTER':  return { conditions: [{ col: '', op: '=', val: '', conjunction: 'AND' }] };
    case 'JOIN':    return { join: { targetTable: '', targetTableName: '', type: 'left', on: ['', ''] } };
    case 'FORMULA': return { formula: { newCol: 'Новая_колонка', expr: '' } };
    case 'GROUP':   return { aggregate: { groups: [], aggs: [] } };
    case 'SORT':    return { sort: { sorts: [{ col: '', dir: 'ASC' }] } };
    case 'RENAME':  return { rename: { renames: [{ from: '', to: '' }] } };
    case 'LIMIT':   return { limit: 100, offset: 0 };
    case 'SELECT':    return { select: { columns: [] } };
    case 'TRANSFORM': return { transforms: [] };
    default: return {};
  }
}

export function PipelineSidebar() {
  const {
    pipelines, activeTabId, addStep, reorderSteps,
    executeActive, toggleSqlPanel, sqlPanelOpen,
    grandmaMode, selectedStepId, setSelectedStep,
    queryResult, addSource, importPipeline,
    pendingEditStepId, setPendingEditStep,
  } = useStore();

  const [editingStep, setEditingStep] = useState<Step | null>(null);
  const [notification, setNotification] = useState<string | null>(null);

  const pipeline = pipelines.find((p) => p.id === activeTabId);

  // Когда добавляется шаг через кнопку — сразу открываем редактор
  useEffect(() => {
    if (!pendingEditStepId || !pipeline) return;
    const step = pipeline.steps.find(s => s.id === pendingEditStepId);
    if (step) {
      setEditingStep(step);
      setPendingEditStep(null);
    }
  }, [pendingEditStepId, pipeline, setPendingEditStep]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  const notify = (msg: string) => {
    setNotification(msg);
    setTimeout(() => setNotification(null), 3000);
  };

  // ── Pipeline Save ──────────────────────────────────────────────
  const handleSavePipeline = () => {
    if (!pipeline) return;
    savePipelineToFile(pipeline);
    notify(`✓ Сохранён "${pipeline.name}"`);
  };

  // ── Pipeline Load ──────────────────────────────────────────────
  const handleLoadPipeline = async () => {
    try {
      const loaded = await loadPipelineFromFile();
      importPipeline(loaded);
      notify(`✓ Загружен "${loaded.name}"`);
    } catch (err: any) {
      notify(`✗ ${err.message}`);
    }
  };

  // ── Save result as Virtual Table ───────────────────────────────
  const handleSaveAsVirtual = () => {
    if (!queryResult || queryResult.rows.length === 0) return;
    const name = prompt(
      'Название виртуальной таблицы:',
      `${pipeline?.name ?? 'Результат'} (итог)`,
    );
    if (!name) return;
    addSource({
      id: uuid(),
      name,
      sourceType: 'virtual',
      columns: queryResult.columns,
      rows: queryResult.rows,
      rowCount: queryResult.totalRows,
    });
    notify(`✓ Сохранено как "${name}"`);
  };



  if (!pipeline) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-slate-500 p-4 text-center">
        <Database size={32} className="mb-2 opacity-50" />
        <p className="text-sm">Нет активного пайплайна</p>
      </div>
    );
  }

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const fromIndex = pipeline.steps.findIndex((s) => s.id === active.id);
    const toIndex   = pipeline.steps.findIndex((s) => s.id === over.id);
    if (fromIndex !== -1 && toIndex !== -1) reorderSteps(pipeline.id, fromIndex, toIndex);
  };

  const compiled = compiler.compile(pipeline, grandmaMode);

  return (
    <div className="flex flex-col h-full bg-slate-900">

      {/* ── Header: pipeline name + save/open ── */}
      <div className="px-3 py-2 border-b border-slate-700 flex-shrink-0">
        <div className="flex items-center gap-2 mb-2">
          <Code2 size={14} className="text-blue-400 flex-shrink-0" />
          <span className="text-sm font-semibold text-slate-200 flex-1 truncate">
            {grandmaMode ? 'Шаги обработки' : 'Pipeline'}
          </span>
          <span className="text-[10px] text-slate-600 flex-shrink-0">
            {pipeline.steps.length} шагов
          </span>
        </div>

        {/* Pipeline file actions */}
        <div className="flex gap-1">
          <button
            onClick={handleSavePipeline}
            className="flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-lg border border-slate-700 hover:border-blue-500/50 text-[11px] text-slate-400 hover:text-blue-300 transition-colors"
            title="Сохранить пайплайн в файл (.datasense.json)"
          >
            <Save size={11} />
            {grandmaMode ? 'Сохранить' : 'Сохранить'}
          </button>
          <button
            onClick={handleLoadPipeline}
            className="flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-lg border border-slate-700 hover:border-blue-500/50 text-[11px] text-slate-400 hover:text-blue-300 transition-colors"
            title="Загрузить пайплайн из файла"
          >
            <FolderOpen size={11} />
            {grandmaMode ? 'Открыть' : 'Открыть'}
          </button>
        </div>
      </div>

      {/* ── Steps list ── */}
      <div className="flex-1 overflow-y-auto p-2 custom-scroll min-h-0">
        {pipeline.steps.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-32 text-slate-600 text-center gap-2">
            <Database size={24} className="opacity-40" />
            <p className="text-xs">Добавьте первый шаг ↓</p>
            <p className="text-[10px] text-slate-700">
              Начните с выбора таблицы в Data Sources
            </p>
          </div>
        ) : (
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
            <SortableContext items={pipeline.steps.map((s) => s.id)} strategy={verticalListSortingStrategy}>
              {pipeline.steps.map((step, i) => (
                <StepCard
                  key={step.id}
                  step={step}
                  pipelineId={pipeline.id}
                  index={i}
                  isSelected={selectedStepId === step.id}
                  onDoubleClick={() => setEditingStep(step)}
                />
              ))}
            </SortableContext>
          </DndContext>
        )}
      </div>

      {/* ── Add step buttons ── */}
      <div className="p-2 border-t border-slate-700 flex-shrink-0">
        <p className="text-[10px] text-slate-500 font-semibold uppercase tracking-wider px-1 mb-1.5">
          {grandmaMode ? '＋ Добавить действие' : '＋ Добавить шаг'}
        </p>
        <div className="grid grid-cols-2 gap-1">
          {ADD_STEP_OPTIONS.map(({ type, label, grandmaLabel, icon: Icon, color }) => (
            <button
              key={type}
              className="flex items-center gap-1.5 px-2 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 hover:border-slate-500 transition-all text-left group"
              onClick={() => {
                const newId = addStep(pipeline.id, {
                  type,
                  params: defaultParams(type),
                  uiMeta: { isCollapsed: false, comment: '', isActive: true },
                });
                setPendingEditStep(newId);
              }}
            >
              <Icon size={12} className={color} />
              <span className="text-[11px] text-slate-300 group-hover:text-slate-100 truncate">
                {grandmaMode ? grandmaLabel : label}
              </span>
            </button>
          ))}
        </div>
      </div>

      {/* ── Execution controls ── */}
      <div className="p-2 border-t border-slate-700 space-y-1.5 flex-shrink-0">
        {/* Run button */}
        <button
          className="w-full flex items-center justify-center gap-2 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-sm font-semibold transition-colors"
          onClick={executeActive}
        >
          <Play size={14} />
          {grandmaMode ? 'Показать результат' : 'Выполнить'}
        </button>

        {/* SQL + result actions */}
        <div className="flex gap-1">
          {/* SQL toggle */}
          <button
            className={`flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-lg border text-[11px] transition-colors ${
              sqlPanelOpen
                ? 'border-blue-500 text-blue-400 bg-blue-500/10'
                : 'border-slate-700 text-slate-400 hover:border-slate-500 hover:text-slate-300'
            }`}
            onClick={toggleSqlPanel}
          >
            <Code2 size={11} />
            SQL
          </button>

          {/* As Table (virtual) */}
          {queryResult && queryResult.rows.length > 0 && (
            <button
              className="flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-lg border border-slate-700 text-[11px] text-slate-400 hover:border-purple-500/50 hover:text-purple-300 transition-colors"
              onClick={handleSaveAsVirtual}
              title="Сохранить результат как виртуальную таблицу"
            >
              <Layers size={11} />
              {grandmaMode ? 'Сохранить' : 'As Table'}
            </button>
          )}


        </div>
      </div>

      {/* ── Compiler error ── */}
      {compiled.error && (
        <div className="mx-2 mb-2 p-2 rounded-lg bg-red-900/30 border border-red-800/50 flex-shrink-0">
          <p className="text-xs text-red-400">{compiled.error}</p>
        </div>
      )}

      {/* ── Notification ── */}
      {notification && (
        <div className="mx-2 mb-2 px-3 py-2 bg-slate-700 border border-slate-600 rounded-lg text-xs text-slate-200 flex-shrink-0">
          {notification}
        </div>
      )}

      {/* ── Step Editor Modal ── */}
      {editingStep && (
        <StepEditor
          step={editingStep}
          pipelineId={pipeline.id}
          onClose={() => {
            setEditingStep(null);
            setSelectedStep(null);
          }}
        />
      )}
    </div>
  );
}
