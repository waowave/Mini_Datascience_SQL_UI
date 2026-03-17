import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';
import { v4 as uuid } from 'uuid';
import type {
  Pipeline,
  Step,
  StepType,
  StepParams,
  TableMetadata,
  QueryResult,
} from '../types';
import { workerBridge } from '../engine/WorkerBridge';

// ─────────────────────────────────────────────
//  Demo data
// ─────────────────────────────────────────────
const DEMO_SALES: TableMetadata = {
  id: 'demo-sales',
  name: 'Продажи',
  sourceType: 'demo',
  columns: [
    { name: 'id', type: 'integer' },
    { name: 'Менеджер', type: 'text' },
    { name: 'Регион', type: 'text' },
    { name: 'Товар', type: 'text' },
    { name: 'Категория', type: 'text' },
    { name: 'Цена', type: 'float' },
    { name: 'Количество', type: 'integer' },
    { name: 'Дата', type: 'date' },
  ],
  rows: (() => {
    const managers = ['Иванов А.', 'Петрова М.', 'Сидоров В.', 'Козлова Е.', 'Новиков Д.'];
    const regions = ['Москва', 'СПб', 'Казань', 'Новосибирск', 'Краснодар'];
    const products = [
      { name: 'Ноутбук ASUS', cat: 'Электроника', price: 54990 },
      { name: 'Мышь Logitech', cat: 'Электроника', price: 2490 },
      { name: 'Стол офисный', cat: 'Мебель', price: 18900 },
      { name: 'Кресло руководителя', cat: 'Мебель', price: 34500 },
      { name: 'Бумага А4', cat: 'Канцтовары', price: 390 },
      { name: 'Ручка Parker', cat: 'Канцтовары', price: 1290 },
      { name: 'Монитор 27"', cat: 'Электроника', price: 29990 },
      { name: 'Клавиатура', cat: 'Электроника', price: 3490 },
    ];
    const rows = [];
    for (let i = 1; i <= 200; i++) {
      const p = products[Math.floor(Math.random() * products.length)];
      const d = new Date(2024, Math.floor(Math.random() * 12), Math.floor(Math.random() * 28) + 1);
      rows.push({
        id: i,
        Менеджер: managers[Math.floor(Math.random() * managers.length)],
        Регион: regions[Math.floor(Math.random() * regions.length)],
        Товар: p.name,
        Категория: p.cat,
        Цена: p.price,
        Количество: Math.floor(Math.random() * 10) + 1,
        Дата: d.toISOString().split('T')[0],
      });
    }
    return rows;
  })(),
  rowCount: 200,
};

const DEMO_EMPLOYEES: TableMetadata = {
  id: 'demo-employees',
  name: 'Сотрудники',
  sourceType: 'demo',
  columns: [
    { name: 'ФИО', type: 'text' },
    { name: 'Менеджер', type: 'text' },
    { name: 'Отдел', type: 'text' },
    { name: 'Оклад', type: 'integer' },
  ],
  rows: [
    { ФИО: 'Иванов А.', Менеджер: 'Иванов А.', Отдел: 'Продажи', Оклад: 85000 },
    { ФИО: 'Петрова М.', Менеджер: 'Петрова М.', Отдел: 'Продажи', Оклад: 92000 },
    { ФИО: 'Сидоров В.', Менеджер: 'Сидоров В.', Отдел: 'Логистика', Оклад: 75000 },
    { ФИО: 'Козлова Е.', Менеджер: 'Козлова Е.', Отдел: 'Маркетинг', Оклад: 78000 },
    { ФИО: 'Новиков Д.', Менеджер: 'Новиков Д.', Отдел: 'Продажи', Оклад: 88000 },
  ],
  rowCount: 5,
};

// ─────────────────────────────────────────────
//  Default pipeline factory
// ─────────────────────────────────────────────
function makeDefaultStep(type: StepType, params: StepParams): Step {
  return {
    id: uuid(),
    type,
    params,
    uiMeta: { isCollapsed: false, comment: '', isActive: true },
  };
}

function makeDefaultPipeline(name: string, tableId: string, tableName: string): Pipeline {
  return {
    id: uuid(),
    name,
    steps: [
      makeDefaultStep('FROM', { tableId, tableName }),
    ],
  };
}

// ─────────────────────────────────────────────
//  Store Interface
// ─────────────────────────────────────────────
interface AppStore {
  // Data
  sources: TableMetadata[];
  pipelines: Pipeline[];
  activeTabId: string;
  // UI
  grandmaMode: boolean;
  selectedStepId: string | null;
  queryResult: QueryResult | null;
  isExecuting: boolean;
  sidebarOpen: boolean;
  sqlPanelOpen: boolean;
  activeStepPreview: number | null; // index into pipeline steps for preview
  pendingEditStepId: string | null; // step to open editor for immediately after add
  setPendingEditStep: (id: string | null) => void;
  // Actions: Sources
  addSource: (source: TableMetadata) => void;
  removeSource: (id: string) => void;
  updateSource: (source: TableMetadata) => void;
  // Actions: Pipelines
  addPipeline: (name?: string) => void;
  removePipeline: (id: string) => void;
  setActiveTab: (id: string) => void;
  renamePipeline: (id: string, name: string) => void;
  importPipeline: (pipeline: Pipeline) => void;
  // Actions: Steps
  addStep: (pipelineId: string, step: Omit<Step, 'id'>, afterStepId?: string) => string;
  removeStep: (pipelineId: string, stepId: string) => void;
  updateStep: (pipelineId: string, stepId: string, params: Partial<Step>) => void;
  toggleStepActive: (pipelineId: string, stepId: string) => void;
  reorderSteps: (pipelineId: string, fromIndex: number, toIndex: number) => void;
  // Actions: Execution
  executeActive: () => void;
  setSelectedStep: (id: string | null) => void;
  // Actions: UI
  setGrandmaMode: (v: boolean) => void;
  toggleSidebar: () => void;
  toggleSqlPanel: () => void;
  setActiveStepPreview: (index: number | null) => void;
  // Quick actions (from grid header context menu)
  quickFilter: (col: string, val: any) => void;
  quickSort: (col: string, dir: 'ASC' | 'DESC') => void;
  quickGroup: (col: string) => void;
  quickRename: (from: string, to: string) => void;
  quickFormula: (newCol: string, expr: string) => void;
}

// ─────────────────────────────────────────────
//  Store Implementation
// ─────────────────────────────────────────────
const demoPipeline = makeDefaultPipeline('Анализ продаж', 'demo-sales', 'Продажи');

export const useStore = create<AppStore>()(
  immer((set, get) => ({
    sources: [DEMO_SALES, DEMO_EMPLOYEES],
    pipelines: [demoPipeline],
    activeTabId: demoPipeline.id,
    grandmaMode: false,
    selectedStepId: null,
    queryResult: null,
    isExecuting: false,
    sidebarOpen: true,
    sqlPanelOpen: false,
    activeStepPreview: null,
    pendingEditStepId: null,
    setPendingEditStep: (id) => set((s) => { s.pendingEditStepId = id; }),

    // ── Sources ───────────────────────────────
    addSource: (source) =>
      set((s) => {
        s.sources.push(source);
      }),

    removeSource: (id) =>
      set((s) => {
        s.sources = s.sources.filter((src) => src.id !== id);
      }),

    updateSource: (source) =>
      set((s) => {
        const idx = s.sources.findIndex((src) => src.id === source.id);
        if (idx !== -1) s.sources[idx] = source as any;
      }),

    // ── Pipelines ─────────────────────────────
    addPipeline: (name) =>
      set((s) => {
        const id = uuid();
        const pipeline: Pipeline = {
          id,
          name: name ?? `Запрос ${s.pipelines.length + 1}`,
          steps: [],
        };
        s.pipelines.push(pipeline);
        s.activeTabId = id;
      }),

    removePipeline: (id) =>
      set((s) => {
        s.pipelines = s.pipelines.filter((p) => p.id !== id);
        if (s.activeTabId === id) {
          s.activeTabId = s.pipelines[0]?.id ?? '';
        }
      }),

    setActiveTab: (id) =>
      set((s) => {
        s.activeTabId = id;
        s.selectedStepId = null;
        s.queryResult = null;
      }),

    renamePipeline: (id, name) =>
      set((s) => {
        const p = s.pipelines.find((p) => p.id === id);
        if (p) p.name = name;
      }),

    importPipeline: (pipeline) =>
      set((s) => {
        const newPipeline = { ...pipeline, id: uuid() };
        s.pipelines.push(newPipeline as any);
        s.activeTabId = newPipeline.id;
      }),

    // ── Steps ─────────────────────────────────
    addStep: (pipelineId, stepDef, afterStepId) => {
      const newId = uuid();
      set((s) => {
        const p = s.pipelines.find((p) => p.id === pipelineId);
        if (!p) return;
        const step: Step = { ...stepDef, id: newId };
        if (afterStepId) {
          const idx = p.steps.findIndex((st) => st.id === afterStepId);
          p.steps.splice(idx + 1, 0, step);
        } else {
          p.steps.push(step);
        }
      });
      return newId;
    },

    removeStep: (pipelineId, stepId) =>
      set((s) => {
        const p = s.pipelines.find((p) => p.id === pipelineId);
        if (p) p.steps = p.steps.filter((st) => st.id !== stepId);
      }),

    updateStep: (pipelineId, stepId, patch) =>
      set((s) => {
        const p = s.pipelines.find((p) => p.id === pipelineId);
        if (!p) return;
        const step = p.steps.find((st) => st.id === stepId);
        if (!step) return;
        Object.assign(step, patch);
        if (patch.params) step.params = { ...step.params, ...patch.params };
      }),

    toggleStepActive: (pipelineId, stepId) =>
      set((s) => {
        const p = s.pipelines.find((p) => p.id === pipelineId);
        const step = p?.steps.find((st) => st.id === stepId);
        if (step) step.uiMeta.isActive = !step.uiMeta.isActive;
      }),

    reorderSteps: (pipelineId, fromIndex, toIndex) =>
      set((s) => {
        const p = s.pipelines.find((p) => p.id === pipelineId);
        if (!p) return;
        const [moved] = p.steps.splice(fromIndex, 1);
        p.steps.splice(toIndex, 0, moved);
      }),

    // ── Execution ─────────────────────────────
    executeActive: () => {
      const { pipelines, activeTabId, sources } = get();
      const pipeline = pipelines.find((p) => p.id === activeTabId);
      if (!pipeline) return;

      set((s) => { s.isExecuting = true; });

      workerBridge
        .execute(pipeline, sources)
        .then((result) => {
          set((s) => {
            s.queryResult = result;
            s.isExecuting = false;
          });
        })
        .catch(() => {
          set((s) => { s.isExecuting = false; });
        });
    },

    setSelectedStep: (id) =>
      set((s) => { s.selectedStepId = id; }),

    // ── UI ────────────────────────────────────
    setGrandmaMode: (v) =>
      set((s) => { s.grandmaMode = v; }),

    toggleSidebar: () =>
      set((s) => { s.sidebarOpen = !s.sidebarOpen; }),

    toggleSqlPanel: () =>
      set((s) => { s.sqlPanelOpen = !s.sqlPanelOpen; }),

    setActiveStepPreview: (index) =>
      set((s) => { s.activeStepPreview = index; }),

    // ── Quick actions ─────────────────────────
    quickFilter: (col, val) => {
      const { pipelines, activeTabId, addStep } = get();
      const pipeline = pipelines.find((p) => p.id === activeTabId);
      if (!pipeline) return;
      const lastStep = pipeline.steps[pipeline.steps.length - 1];
      addStep(activeTabId, {
        type: 'FILTER',
        params: {
          conditions: [{ col, op: '=', val: String(val), conjunction: 'AND' }],
        },
        uiMeta: { isCollapsed: false, comment: '', isActive: true },
      }, lastStep?.id);
    },

    quickSort: (col, dir) => {
      const { pipelines, activeTabId, addStep } = get();
      const pipeline = pipelines.find((p) => p.id === activeTabId);
      if (!pipeline) return;
      const lastStep = pipeline.steps[pipeline.steps.length - 1];
      addStep(activeTabId, {
        type: 'SORT',
        params: { sort: { sorts: [{ col, dir }] } },
        uiMeta: { isCollapsed: false, comment: '', isActive: true },
      }, lastStep?.id);
    },

    quickGroup: (col) => {
      const { pipelines, activeTabId, addStep } = get();
      const pipeline = pipelines.find((p) => p.id === activeTabId);
      if (!pipeline) return;
      const lastStep = pipeline.steps[pipeline.steps.length - 1];
      addStep(activeTabId, {
        type: 'GROUP',
        params: {
          aggregate: {
            groups: [col],
            aggs: [{ col, func: 'COUNT', alias: `Количество_${col}` }],
          },
        },
        uiMeta: { isCollapsed: false, comment: '', isActive: true },
      }, lastStep?.id);
    },

    quickRename: (from, to) => {
      const { pipelines, activeTabId, addStep } = get();
      const pipeline = pipelines.find((p) => p.id === activeTabId);
      if (!pipeline) return;
      const lastStep = pipeline.steps[pipeline.steps.length - 1];
      addStep(activeTabId, {
        type: 'RENAME',
        params: { rename: { renames: [{ from, to }] } },
        uiMeta: { isCollapsed: false, comment: '', isActive: true },
      }, lastStep?.id);
    },

    quickFormula: (newCol, expr) => {
      const { pipelines, activeTabId, addStep } = get();
      const pipeline = pipelines.find((p) => p.id === activeTabId);
      if (!pipeline) return;
      const lastStep = pipeline.steps[pipeline.steps.length - 1];
      addStep(activeTabId, {
        type: 'FORMULA',
        params: { formula: { newCol, expr } },
        uiMeta: { isCollapsed: false, comment: '', isActive: true },
      }, lastStep?.id);
    },
  }))
);

// Helpers
export const getActivePipeline = (state: AppStore): Pipeline | undefined =>
  state.pipelines.find((p) => p.id === state.activeTabId);
