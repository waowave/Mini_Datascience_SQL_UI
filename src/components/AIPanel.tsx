/**
 * AIPanel — чистый LLM клиент для генерации пайплайна.
 *
 * Архитектура:
 * - Никакого встроенного парсера / самодеятельных ответов
 * - Генерирует системный промпт со схемой таблиц
 * - Отправляет запрос к локальному LLM (Ollama / LM Studio / любой OpenAI-совместимый)
 * - Поддержка Bearer-токена и Basic Auth
 * - Streaming ответа через ReadableStream
 * - Показывает сырой ответ + пытается распарсить JSON
 * - Применяет шаги к пайплайну только по явному подтверждению пользователя
 */
import { useState, useRef, useEffect, useCallback } from 'react';
import {
  Sparkles, X, Send, Copy, Check, Settings, ChevronDown, ChevronUp,
  Loader2, Code2, Play, Plus, AlertCircle, Info, Key, Globe,
  RotateCcw, Trash2,
} from 'lucide-react';
import { useStore } from '../store/useStore';
import { v4 as uuid } from 'uuid';
import type { Step, StepType, StepParams } from '../types';

// ─────────────────────────────────────────────
//  Types
// ─────────────────────────────────────────────
interface LLMConfig {
  // API endpoint — Ollama: http://localhost:11434/api/chat
  //                LM Studio: http://localhost:1234/v1/chat/completions
  //                OpenAI-compatible: https://api.openai.com/v1/chat/completions
  endpoint: string;
  // Имя модели (передаётся в поле "model")
  model: string;
  // Тип авторизации
  authType: 'none' | 'bearer' | 'basic';
  bearerToken: string;
  basicUser: string;
  basicPassword: string;
  // API формат
  apiFormat: 'ollama' | 'openai';
  // Температура (0-2)
  temperature: number;
  // Максимум токенов
  maxTokens: number;
}

interface Message {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  // Если assistant вернул JSON шаги — храним их распарсенными
  parsedSteps?: ParsedPipelineResult;
  isStreaming?: boolean;
  error?: string;
}

interface ParsedPipelineResult {
  steps: Omit<Step, 'id'>[];
  explanation?: string;
  raw: string;
}

interface Props {
  onClose: () => void;
}

// ─────────────────────────────────────────────
//  Prompt Builder
// ─────────────────────────────────────────────
// Тип → читаемое название
function typeLabel(t: string) {
  if (t === 'integer') return 'INTEGER (целое число)';
  if (t === 'float')   return 'FLOAT (дробное число)';
  if (t === 'date')    return 'DATE (дата/время)';
  return 'TEXT (строка)';
}

// Примеры уникальных значений из данных (до 5 штук)
function sampleValues(rows: any[], colName: string): string {
  if (!rows?.length) return '';
  const seen = new Set<string>();
  for (const row of rows) {
    const v = row[colName];
    if (v !== null && v !== undefined && v !== '') {
      seen.add(String(v));
      if (seen.size >= 5) break;
    }
  }
  if (!seen.size) return '';
  return ` — примеры: ${[...seen].map(v => `"${v}"`).join(', ')}`;
}

// Статистика числовой колонки
function numericStats(rows: any[], colName: string): string {
  if (!rows?.length) return '';
  const vals = rows.map(r => Number(r[colName])).filter(v => !isNaN(v));
  if (!vals.length) return '';
  const sum = vals.reduce((a, b) => a + b, 0);
  const min = Math.min(...vals);
  const max = Math.max(...vals);
  const avg = sum / vals.length;
  return ` — min: ${min.toLocaleString('ru-RU')}, max: ${max.toLocaleString('ru-RU')}, avg: ${avg.toFixed(2)}`;
}

function buildSystemPrompt(sources: any[], pipeline: any): string {
  const tables = sources.map(s => {
    const rowCount = s.rowCount ?? s.rows?.length ?? 0;
    const cols = s.columns.map((c: any) => {
      const isNum = c.type === 'integer' || c.type === 'float';
      const stats = isNum
        ? numericStats(s.rows, c.name)
        : sampleValues(s.rows, c.name);
      return `    • "${c.name}" [${typeLabel(c.type)}]${stats}`;
    }).join('\n');
    return `  Таблица "${s.name}" (id: "${s.id}", строк: ${rowCount.toLocaleString('ru-RU')}, тип: ${s.sourceType ?? 'table'}):\n${cols}`;
  }).join('\n\n');

  const currentSteps = pipeline?.steps?.length
    ? pipeline.steps.map((st: any, i: number) =>
        `  Шаг ${i} [${st.type}]: ${JSON.stringify(st.params)}`
      ).join('\n')
    : '  (пайплайн пустой)';

  return `Ты — аналитик данных. Пользователь описывает задачу на естественном языке, ты генерируешь JSON-пайплайн.

━━━ ДОСТУПНЫЕ ТАБЛИЦЫ ━━━
${tables}

━━━ ТЕКУЩИЙ ПАЙПЛАЙН ━━━
${currentSteps}

━━━ СХЕМА ШАГОВ ━━━
Каждый шаг — объект { "type": "...", "params": {...}, "comment": "..." }

FROM — выбор источника данных:
  { "type": "FROM", "params": { "tableId": "<id таблицы>", "tableName": "<имя>" }, "comment": "Источник" }

FILTER — фильтрация строк:
  { "type": "FILTER", "params": { "conditions": [{ "col": "<колонка>", "op": "<оператор>", "val": "<значение>", "conjunction": "AND" }] }, "comment": "..." }
  Операторы: "=", "!=", ">", ">=", "<", "<=", "LIKE", "NOT LIKE", "IS NULL", "IS NOT NULL", "IN"
  Для IN — val должен быть массивом: ["знач1", "знач2"]
  Для LIKE — используй % как wildcard: "%текст%"

GROUP — группировка и агрегация:
  { "type": "GROUP", "params": { "aggregate": { "groups": ["<колонка группировки>"], "aggs": [{ "col": "<колонка>", "func": "<функция>", "alias": "<имя результата>" }] } }, "comment": "..." }
  Функции: "SUM", "AVG", "COUNT", "COUNT DISTINCT", "MIN", "MAX"

SORT — сортировка:
  { "type": "SORT", "params": { "sort": { "sorts": [{ "col": "<колонка>", "dir": "ASC" }] } }, "comment": "..." }
  dir: "ASC" или "DESC"

FORMULA — вычисляемая колонка:
  { "type": "FORMULA", "params": { "formula": { "newCol": "<имя новой колонки>", "expr": "[Колонка1] * [Колонка2]" } }, "comment": "..." }
  В expr имена колонок оборачиваются в квадратные скобки.

JOIN — соединение таблиц:
  { "type": "JOIN", "params": { "join": { "targetTable": "<id таблицы>", "targetTableName": "<имя>", "type": "left", "on": ["<левая колонка>", "<правая колонка>"] } }, "comment": "..." }
  type: "inner", "left", "right", "full"

RENAME — переименование колонок:
  { "type": "RENAME", "params": { "rename": { "renames": [{ "from": "<старое>", "to": "<новое>" }] } }, "comment": "..." }

LIMIT — ограничение количества строк:
  { "type": "LIMIT", "params": { "limit": <число> }, "comment": "..." }

SELECT — выбор конкретных колонок:
  { "type": "SELECT", "params": { "select": { "columns": ["<колонка1>", "<колонка2>"] } }, "comment": "..." }

━━━ ТИПЫ ДАННЫХ ━━━
• INTEGER / FLOAT — числа. Используй операторы: =, !=, >, >=, <, <=. В формулах: [col] * 1.2
• TEXT — строки. Для поиска используй LIKE с %: "%Казань%". Для точного — "=".
• DATE — дата. Сравнивай строками ISO: "2024-01-01". Функции: YEAR([col]), MONTH([col]).

━━━ ПРАВИЛА ━━━
1. Имена колонок ТОЧНО как в схеме — регистр важен
2. Первый шаг ВСЕГДА FROM с реальным id и именем таблицы
3. Если задача непонятна или нет подходящей таблицы — задай вопрос в "clarification" и верни пустой "steps": []
4. Если пайплайн уже имеет FROM — добавь только недостающие шаги без повторного FROM
5. Для подсчёта количества: GROUP с func="COUNT", col="*", alias="Количество"
6. Для поиска по тексту: FILTER с op="LIKE", val="%искомое%"
7. Всегда добавляй осмысленный "comment" к каждому шагу на русском языке

━━━ ФОРМАТ ОТВЕТА ━━━
Отвечай ТОЛЬКО валидным JSON (без markdown, без \`\`\`, без пояснений вне JSON):
{
  "steps": [ ...массив шагов... ],
  "explanation": "Краткое описание что делает пайплайн",
  "clarification": "Уточняющий вопрос если нужно (опционально)"
}`;
}

// ─────────────────────────────────────────────
//  LLM API Call
// ─────────────────────────────────────────────
async function callLLM(
  config: LLMConfig,
  messages: { role: string; content: string }[],
  onToken: (token: string) => void,
  signal: AbortSignal,
): Promise<string> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };

  // Авторизация
  if (config.authType === 'bearer' && config.bearerToken) {
    headers['Authorization'] = `Bearer ${config.bearerToken}`;
  } else if (config.authType === 'basic' && config.basicUser) {
    const creds = btoa(`${config.basicUser}:${config.basicPassword}`);
    headers['Authorization'] = `Basic ${creds}`;
  }

  let body: any;
  if (config.apiFormat === 'ollama') {
    // Ollama /api/chat format
    body = {
      model: config.model,
      messages,
      stream: true,
      options: {
        temperature: config.temperature,
        num_predict: config.maxTokens,
      },
    };
  } else {
    // OpenAI-compatible format (LM Studio, OpenAI, etc.)
    body = {
      model: config.model,
      messages,
      stream: true,
      temperature: config.temperature,
      max_tokens: config.maxTokens,
    };
  }

  const response = await fetch(config.endpoint, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
    signal,
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`HTTP ${response.status}: ${err}`);
  }

  if (!response.body) throw new Error('Нет тела ответа');

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let fullText = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    const chunk = decoder.decode(value, { stream: true });
    const lines = chunk.split('\n').filter(l => l.trim());

    for (const line of lines) {
      let data = line;
      // SSE format: "data: {...}"
      if (line.startsWith('data: ')) {
        data = line.slice(6);
        if (data === '[DONE]') continue;
      }

      try {
        const parsed = JSON.parse(data);
        let token = '';

        if (config.apiFormat === 'ollama') {
          // Ollama: { message: { content: "..." }, done: false }
          token = parsed.message?.content ?? parsed.response ?? '';
        } else {
          // OpenAI: { choices: [{ delta: { content: "..." } }] }
          token = parsed.choices?.[0]?.delta?.content ?? '';
        }

        if (token) {
          fullText += token;
          onToken(token);
        }
      } catch {
        // Некоторые чанки не являются JSON — пропускаем
      }
    }
  }

  return fullText;
}

// ─────────────────────────────────────────────
//  JSON Step Parser
// ─────────────────────────────────────────────
function tryParseSteps(text: string): ParsedPipelineResult | null {
  // Попытка найти JSON в тексте (даже если LLM добавил что-то вокруг)
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) return null;

  try {
    const parsed = JSON.parse(jsonMatch[0]);
    if (!parsed.steps || !Array.isArray(parsed.steps)) return null;

    const mkMeta = () => ({ isCollapsed: false, comment: '', isActive: true });

    const steps: Omit<Step, 'id'>[] = parsed.steps.map((s: any) => ({
      type: s.type as StepType,
      params: s.params as StepParams,
      uiMeta: { ...mkMeta(), comment: s.comment ?? '' },
    }));

    return {
      steps,
      explanation: parsed.explanation,
      raw: jsonMatch[0],
    };
  } catch {
    return null;
  }
}

// ─────────────────────────────────────────────
//  LocalStorage key
// ─────────────────────────────────────────────
const LS_CONFIG_KEY = 'datasense_llm_config';
const LS_PRESET_KEY = 'datasense_llm_preset';

// ─────────────────────────────────────────────
//  Default config
// ─────────────────────────────────────────────
const DEFAULT_CONFIG: LLMConfig = {
  endpoint: 'http://localhost:11434/api/chat',
  model: 'llama3',
  authType: 'none',
  bearerToken: '',
  basicUser: '',
  basicPassword: '',
  apiFormat: 'ollama',
  temperature: 0.1,
  maxTokens: 2048,
};

// Preset index: 0=Ollama, 1=LMStudio, 2=OpenAI, 3=Custom
const PRESET_CONFIGS = [
  {
    id: 'ollama',
    label: 'Ollama',
    sublabel: 'локально',
    endpoint: 'http://localhost:11434/api/chat',
    apiFormat: 'ollama' as const,
    hint: 'Запустите: ollama serve && ollama pull llama3',
  },
  {
    id: 'lmstudio',
    label: 'LM Studio',
    sublabel: 'локально',
    endpoint: 'http://localhost:1234/v1/chat/completions',
    apiFormat: 'openai' as const,
    hint: 'Запустите LM Studio → Local Server → включите сервер',
  },
  {
    id: 'openai',
    label: 'OpenAI',
    sublabel: 'API',
    endpoint: 'https://api.openai.com/v1/chat/completions',
    apiFormat: 'openai' as const,
    hint: 'Укажите Bearer токен в поле авторизации ниже',
  },
  {
    id: 'custom',
    label: 'Другой',
    sublabel: 'OpenAI-совместимый',
    endpoint: '',
    apiFormat: 'openai' as const,
    hint: 'Введите endpoint вручную — любой OpenAI-совместимый API',
  },
];

// ─────────────────────────────────────────────
//  Hook: persist config to localStorage
// ─────────────────────────────────────────────
function useLLMConfig() {
  const [config, setConfigRaw] = useState<LLMConfig>(() => {
    try {
      const saved = localStorage.getItem(LS_CONFIG_KEY);
      if (saved) return { ...DEFAULT_CONFIG, ...JSON.parse(saved) };
    } catch {}
    return DEFAULT_CONFIG;
  });

  const [selectedPresetId, setSelectedPresetIdRaw] = useState<string>(() => {
    return localStorage.getItem(LS_PRESET_KEY) ?? 'ollama';
  });

  const setConfig = (c: LLMConfig) => {
    setConfigRaw(c);
    try {
      localStorage.setItem(LS_CONFIG_KEY, JSON.stringify(c));
    } catch {}
  };

  const setSelectedPresetId = (id: string) => {
    setSelectedPresetIdRaw(id);
    try {
      localStorage.setItem(LS_PRESET_KEY, id);
    } catch {}
  };

  return { config, setConfig, selectedPresetId, setSelectedPresetId };
}

// ─────────────────────────────────────────────
//  Settings Panel
// ─────────────────────────────────────────────
function SettingsPanel({ config, onChange, selectedPresetId, onSelectPreset }: {
  config: LLMConfig;
  onChange: (c: LLMConfig) => void;
  selectedPresetId: string;
  onSelectPreset: (id: string) => void;
}) {
  const [showPassword, setShowPassword] = useState(false);

  const set = (patch: Partial<LLMConfig>) => onChange({ ...config, ...patch });

  const handlePreset = (p: typeof PRESET_CONFIGS[0]) => {
    onSelectPreset(p.id);
    // Для custom — не перезаписываем endpoint, только format
    if (p.id === 'custom') {
      set({ apiFormat: p.apiFormat });
    } else {
      set({ endpoint: p.endpoint, apiFormat: p.apiFormat });
    }
  };

  const activePreset = PRESET_CONFIGS.find(p => p.id === selectedPresetId);

  return (
    <div className="flex flex-col gap-3 p-3 bg-slate-900 border border-slate-700 rounded-xl">
      <div className="text-xs font-semibold text-slate-400 uppercase tracking-wider flex items-center gap-2">
        <Settings size={12} />
        Настройки LLM
      </div>

      {/* Presets */}
      <div>
        <div className="text-[10px] text-slate-500 mb-2">Провайдер</div>
        <div className="grid grid-cols-2 gap-1.5">
          {PRESET_CONFIGS.map(p => {
            const isActive = selectedPresetId === p.id;
            return (
              <button
                key={p.id}
                onClick={() => handlePreset(p)}
                className={`flex flex-col items-start px-3 py-2 rounded-xl border transition-all text-left ${
                  isActive
                    ? 'bg-violet-600/20 border-violet-500 text-violet-200'
                    : 'bg-slate-800 border-slate-700 text-slate-400 hover:border-slate-500 hover:text-slate-300'
                }`}
              >
                <span className={`text-xs font-semibold ${isActive ? 'text-violet-200' : 'text-slate-300'}`}>
                  {p.label}
                </span>
                <span className={`text-[10px] ${isActive ? 'text-violet-400' : 'text-slate-500'}`}>
                  {p.sublabel}
                </span>
              </button>
            );
          })}
        </div>
        {activePreset?.hint && (
          <div className="mt-2 text-[10px] text-slate-500 flex items-start gap-1.5 bg-slate-800/60 rounded-lg px-2 py-1.5">
            <Info size={9} className="mt-0.5 flex-shrink-0 text-violet-400" />
            {activePreset.hint}
          </div>
        )}
      </div>

      {/* Endpoint */}
      <div>
        <label className="text-[10px] text-slate-500 mb-1 flex items-center gap-1">
          <Globe size={9} /> Endpoint URL
        </label>
        <input
          value={config.endpoint}
          onChange={e => {
            set({ endpoint: e.target.value });
            // Если редактируем endpoint вручную и это не совпадает с пресетами — переключаемся на custom
            const matchedPreset = PRESET_CONFIGS.find(p => p.id !== 'custom' && p.endpoint === e.target.value);
            if (!matchedPreset && selectedPresetId !== 'custom') {
              onSelectPreset('custom');
            } else if (matchedPreset) {
              onSelectPreset(matchedPreset.id);
            }
          }}
          placeholder="http://localhost:11434/api/chat"
          className="w-full bg-slate-800 border border-slate-700 rounded-lg px-2 py-1.5 text-xs text-slate-200 font-mono focus:border-violet-500 focus:outline-none"
        />
      </div>

      {/* Model + Format */}
      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className="text-[10px] text-slate-500 mb-1 block">Модель</label>
          <input
            value={config.model}
            onChange={e => set({ model: e.target.value })}
            placeholder="llama3, phi-3, mistral..."
            className="w-full bg-slate-800 border border-slate-700 rounded-lg px-2 py-1.5 text-xs text-slate-200 focus:border-violet-500 focus:outline-none"
          />
        </div>
        <div>
          <label className="text-[10px] text-slate-500 mb-1 block">Формат API</label>
          <select
            value={config.apiFormat}
            onChange={e => set({ apiFormat: e.target.value as any })}
            className="w-full bg-slate-800 border border-slate-700 rounded-lg px-2 py-1.5 text-xs text-slate-200 focus:border-violet-500 focus:outline-none"
          >
            <option value="ollama">Ollama</option>
            <option value="openai">OpenAI-compatible</option>
          </select>
        </div>
      </div>

      {/* Auth */}
      <div>
        <label className="text-[10px] text-slate-500 mb-1 flex items-center gap-1">
          <Key size={9} /> Авторизация
        </label>
        <div className="flex gap-1 mb-2">
          {(['none', 'bearer', 'basic'] as const).map(t => (
            <button
              key={t}
              onClick={() => set({ authType: t })}
              className={`flex-1 py-1 text-[10px] rounded-lg border transition-colors ${
                config.authType === t
                  ? 'bg-violet-600/20 border-violet-500 text-violet-300'
                  : 'bg-slate-800 border-slate-700 text-slate-400 hover:border-slate-500'
              }`}
            >
              {t === 'none' ? 'Без авторизации' : t === 'bearer' ? 'Bearer Token' : 'Basic Auth'}
            </button>
          ))}
        </div>

        {config.authType === 'bearer' && (
          <input
            type={showPassword ? 'text' : 'password'}
            value={config.bearerToken}
            onChange={e => set({ bearerToken: e.target.value })}
            placeholder="sk-..."
            className="w-full bg-slate-800 border border-slate-700 rounded-lg px-2 py-1.5 text-xs text-slate-200 font-mono focus:border-violet-500 focus:outline-none"
          />
        )}

        {config.authType === 'basic' && (
          <div className="flex gap-2">
            <input
              value={config.basicUser}
              onChange={e => set({ basicUser: e.target.value })}
              placeholder="Логин"
              className="flex-1 bg-slate-800 border border-slate-700 rounded-lg px-2 py-1.5 text-xs text-slate-200 focus:border-violet-500 focus:outline-none"
            />
            <div className="relative flex-1">
              <input
                type={showPassword ? 'text' : 'password'}
                value={config.basicPassword}
                onChange={e => set({ basicPassword: e.target.value })}
                placeholder="Пароль"
                className="w-full bg-slate-800 border border-slate-700 rounded-lg px-2 py-1.5 text-xs text-slate-200 focus:border-violet-500 focus:outline-none"
              />
              <button
                onClick={() => setShowPassword(!showPassword)}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300"
              >
                {showPassword ? '🙈' : '👁'}
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Advanced */}
      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className="text-[10px] text-slate-500 mb-1 block">
            Температура: {config.temperature}
          </label>
          <input
            type="range" min="0" max="2" step="0.05"
            value={config.temperature}
            onChange={e => set({ temperature: parseFloat(e.target.value) })}
            className="w-full accent-violet-500"
          />
        </div>
        <div>
          <label className="text-[10px] text-slate-500 mb-1 block">Макс. токенов</label>
          <input
            type="number" min="256" max="8192" step="256"
            value={config.maxTokens}
            onChange={e => set({ maxTokens: parseInt(e.target.value) })}
            className="w-full bg-slate-800 border border-slate-700 rounded-lg px-2 py-1.5 text-xs text-slate-200 focus:border-violet-500 focus:outline-none"
          />
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────
//  Message Bubble
// ─────────────────────────────────────────────
function MessageBubble({ msg, onApply, onAppend }: {
  msg: Message;
  onApply: (steps: Omit<Step, 'id'>[]) => void;
  onAppend: (steps: Omit<Step, 'id'>[]) => void;
}) {
  const [showRaw, setShowRaw] = useState(false);
  const [copied, setCopied] = useState(false);

  const copyRaw = () => {
    navigator.clipboard.writeText(msg.parsedSteps?.raw ?? msg.content);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  if (msg.role === 'user') {
    return (
      <div className="flex justify-end">
        <div className="max-w-[80%] bg-violet-600/20 border border-violet-500/30 rounded-2xl rounded-tr-sm px-3 py-2 text-sm text-slate-200">
          {msg.content}
        </div>
      </div>
    );
  }

  if (msg.role === 'system') {
    return (
      <div className="flex justify-center">
        <div className="text-[10px] text-slate-600 px-3 py-1 bg-slate-800/50 rounded-full">
          {msg.content}
        </div>
      </div>
    );
  }

  // Assistant message
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-start gap-2">
        <div className="w-6 h-6 rounded-lg bg-violet-600 flex items-center justify-center flex-shrink-0 mt-0.5">
          <Sparkles size={11} className="text-white" />
        </div>
        <div className="flex-1 min-w-0">
          {msg.error ? (
            <div className="bg-red-900/30 border border-red-700/40 rounded-xl px-3 py-2">
              <div className="flex items-center gap-2 text-red-400 text-xs font-medium mb-1">
                <AlertCircle size={12} /> Ошибка
              </div>
              <div className="text-xs text-red-300 font-mono">{msg.error}</div>
            </div>
          ) : (
            <div className="bg-slate-800/60 border border-slate-700/50 rounded-xl rounded-tl-sm px-3 py-2">
              {/* Streaming / raw content */}
              <div className="text-sm text-slate-200 whitespace-pre-wrap break-words">
                {msg.isStreaming ? (
                  <>
                    {msg.content}
                    <span className="inline-block w-0.5 h-3.5 bg-violet-400 ml-0.5 animate-pulse" />
                  </>
                ) : msg.parsedSteps ? (
                  // Успешно распарсили — показываем explanation
                  <div>
                    {msg.parsedSteps.explanation && (
                      <p className="text-slate-300 mb-2">{msg.parsedSteps.explanation}</p>
                    )}
                    <div className="text-xs text-slate-400">
                      Сгенерировано шагов: <span className="text-violet-400 font-semibold">{msg.parsedSteps.steps.length}</span>
                    </div>
                  </div>
                ) : (
                  // Не удалось распарсить — показываем сырой текст
                  msg.content
                )}
              </div>
            </div>
          )}

          {/* Actions for parsed result */}
          {!msg.isStreaming && msg.parsedSteps && (
            <div className="mt-2 flex flex-col gap-2">
              {/* Step preview */}
              <div className="bg-slate-900 border border-slate-700 rounded-xl overflow-hidden">
                <div className="px-3 py-1.5 border-b border-slate-700 flex items-center justify-between">
                  <span className="text-[10px] text-slate-400 font-semibold uppercase tracking-wider">
                    Шаги пайплайна
                  </span>
                  <div className="flex gap-1">
                    <button
                      onClick={() => setShowRaw(!showRaw)}
                      className="text-[10px] text-slate-500 hover:text-slate-300 flex items-center gap-1"
                    >
                      <Code2 size={9} /> {showRaw ? 'Скрыть JSON' : 'JSON'}
                    </button>
                    <button onClick={copyRaw} className="text-[10px] text-slate-500 hover:text-slate-300 flex items-center gap-1">
                      {copied ? <Check size={9} className="text-green-400" /> : <Copy size={9} />}
                    </button>
                  </div>
                </div>

                {showRaw ? (
                  <pre className="p-2 text-[10px] font-mono text-green-400 overflow-x-auto max-h-48">
                    {msg.parsedSteps.raw}
                  </pre>
                ) : (
                  <div className="divide-y divide-slate-800">
                    {msg.parsedSteps.steps.map((step, i) => (
                      <div key={i} className="flex items-center gap-2 px-3 py-1.5">
                        <span className="text-[10px] w-4 h-4 rounded-full bg-slate-700 flex items-center justify-center text-slate-400 font-mono flex-shrink-0">
                          {i}
                        </span>
                        <span className={`text-[10px] font-mono font-semibold px-1.5 py-0.5 rounded ${
                          step.type === 'FROM' ? 'bg-blue-900/40 text-blue-300' :
                          step.type === 'FILTER' ? 'bg-yellow-900/40 text-yellow-300' :
                          step.type === 'GROUP' ? 'bg-purple-900/40 text-purple-300' :
                          step.type === 'SORT' ? 'bg-green-900/40 text-green-300' :
                          step.type === 'FORMULA' ? 'bg-orange-900/40 text-orange-300' :
                          step.type === 'JOIN' ? 'bg-pink-900/40 text-pink-300' :
                          'bg-slate-700 text-slate-300'
                        }`}>
                          {step.type}
                        </span>
                        <span className="text-[10px] text-slate-400 truncate">
                          {step.uiMeta.comment || JSON.stringify(step.params).slice(0, 60)}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Apply buttons */}
              <div className="flex gap-2">
                <button
                  onClick={() => onApply(msg.parsedSteps!.steps)}
                  className="flex-1 flex items-center justify-center gap-1.5 py-1.5 bg-violet-600 hover:bg-violet-500 rounded-lg text-xs font-semibold text-white transition-colors"
                >
                  <Play size={11} /> Заменить пайплайн
                </button>
                <button
                  onClick={() => onAppend(msg.parsedSteps!.steps)}
                  className="flex-1 flex items-center justify-center gap-1.5 py-1.5 bg-slate-700 hover:bg-slate-600 rounded-lg text-xs font-semibold text-slate-200 transition-colors"
                >
                  <Plus size={11} /> Добавить к текущему
                </button>
              </div>
            </div>
          )}

          {/* Failed parse — show raw */}
          {!msg.isStreaming && !msg.parsedSteps && !msg.error && msg.content && (
            <div className="mt-1 text-[10px] text-amber-500 flex items-center gap-1">
              <AlertCircle size={10} />
              Не удалось распознать шаги — скопируйте ответ вручную
              <button onClick={copyRaw} className="underline hover:text-amber-400">
                {copied ? '✓ Скопировано' : 'Копировать'}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────
//  Main Component
// ─────────────────────────────────────────────
export function AIPanel({ onClose }: Props) {
  const { sources, pipelines, activeTabId, addStep, removeStep, executeActive } = useStore();
  const pipeline = pipelines.find(p => p.id === activeTabId);

  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showPrompt, setShowPrompt] = useState(false);
  const [promptCopied, setPromptCopied] = useState(false);
  const { config, setConfig, selectedPresetId, setSelectedPresetId } = useLLMConfig();

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const systemPrompt = buildSystemPrompt(sources, pipeline);

  const copyPrompt = () => {
    navigator.clipboard.writeText(systemPrompt);
    setPromptCopied(true);
    setTimeout(() => setPromptCopied(false), 2000);
  };

  const applySteps = useCallback((steps: Omit<Step, 'id'>[], replace: boolean) => {
    if (!pipeline) return;
    if (replace) {
      [...pipeline.steps].forEach(s => removeStep(pipeline.id, s.id));
    }
    steps.forEach(step => addStep(activeTabId, step));
    setTimeout(() => executeActive(), 100);
    // Уведомление
    setMessages(prev => [...prev, {
      id: uuid(),
      role: 'system',
      content: replace
        ? `✓ Пайплайн заменён (${steps.length} шагов)`
        : `✓ Добавлено ${steps.length} шагов к пайплайну`,
    }]);
  }, [pipeline, activeTabId, addStep, removeStep, executeActive]);

  const sendMessage = async () => {
    const text = input.trim();
    if (!text || isLoading) return;

    const userMsg: Message = { id: uuid(), role: 'user', content: text };
    setMessages(prev => [...prev, userMsg]);
    setInput('');
    setIsLoading(true);

    // Создаём AbortController для возможности отмены
    abortRef.current = new AbortController();

    // Стриминг-сообщение
    const assistantId = uuid();
    setMessages(prev => [...prev, {
      id: assistantId,
      role: 'assistant',
      content: '',
      isStreaming: true,
    }]);

    try {
      // Строим историю для LLM (system + история + текущий)
      const llmMessages = [
        { role: 'system', content: systemPrompt },
        // Добавляем предыдущие сообщения (только user/assistant)
        ...messages
          .filter(m => m.role === 'user' || m.role === 'assistant')
          .filter(m => !m.isStreaming)
          .slice(-10) // последние 10 для контекста
          .map(m => ({ role: m.role, content: m.content })),
        { role: 'user', content: text },
      ];

      let accumulated = '';

      await callLLM(
        config,
        llmMessages,
        (token) => {
          accumulated += token;
          setMessages(prev => prev.map(m =>
            m.id === assistantId
              ? { ...m, content: accumulated }
              : m
          ));
        },
        abortRef.current.signal,
      );

      // Попытка распарсить результат
      const parsed = tryParseSteps(accumulated);

      setMessages(prev => prev.map(m =>
        m.id === assistantId
          ? { ...m, content: accumulated, isStreaming: false, parsedSteps: parsed ?? undefined }
          : m
      ));
    } catch (err: any) {
      if (err.name === 'AbortError') {
        setMessages(prev => prev.map(m =>
          m.id === assistantId
            ? { ...m, content: '', isStreaming: false, error: 'Запрос отменён' }
            : m
        ));
      } else {
        const errorText = err.message ?? String(err);
        setMessages(prev => prev.map(m =>
          m.id === assistantId
            ? { ...m, content: '', isStreaming: false, error: errorText }
            : m
        ));
      }
    } finally {
      setIsLoading(false);
      abortRef.current = null;
    }
  };

  const cancelRequest = () => {
    abortRef.current?.abort();
  };

  const clearHistory = () => {
    setMessages([]);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-stretch justify-end bg-black/40 backdrop-blur-sm">
      <div className="w-[520px] max-w-full flex flex-col bg-slate-950 border-l border-slate-700 shadow-2xl">

        {/* Header */}
        <div className="flex items-center gap-3 px-4 py-3 border-b border-slate-700 flex-shrink-0">
          <div className="w-8 h-8 rounded-xl bg-violet-600 flex items-center justify-center">
            <Sparkles size={15} className="text-white" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-sm font-semibold text-slate-100">AI Аналитик</div>
            <div className="text-[10px] text-slate-500">
              {config.model} · {config.endpoint}
            </div>
          </div>
          <div className="flex items-center gap-1">
            <button
              onClick={clearHistory}
              className="p-1.5 rounded-lg text-slate-500 hover:text-slate-300 hover:bg-slate-800 transition-colors"
              title="Очистить историю"
            >
              <Trash2 size={14} />
            </button>
            <button
              onClick={() => setShowSettings(!showSettings)}
              className={`p-1.5 rounded-lg transition-colors ${showSettings ? 'bg-violet-600/20 text-violet-400' : 'text-slate-500 hover:text-slate-300 hover:bg-slate-800'}`}
              title="Настройки LLM"
            >
              <Settings size={14} />
            </button>
            <button
              onClick={onClose}
              className="p-1.5 rounded-lg text-slate-500 hover:text-slate-300 hover:bg-slate-800 transition-colors"
            >
              <X size={14} />
            </button>
          </div>
        </div>

        {/* Settings */}
        {showSettings && (
          <div className="px-4 py-3 border-b border-slate-700 flex-shrink-0 overflow-y-auto max-h-[60vh]">
            <SettingsPanel
              config={config}
              onChange={setConfig}
              selectedPresetId={selectedPresetId}
              onSelectPreset={setSelectedPresetId}
            />
          </div>
        )}

        {/* System Prompt toggle */}
        <div className="px-4 py-2 border-b border-slate-700/50 flex-shrink-0">
          <button
            onClick={() => setShowPrompt(!showPrompt)}
            className="flex items-center gap-2 text-[10px] text-slate-500 hover:text-slate-300 transition-colors"
          >
            <Code2 size={10} />
            Системный промпт ({sources.length} таблиц, {pipeline?.steps.length ?? 0} шагов)
            {showPrompt ? <ChevronUp size={10} /> : <ChevronDown size={10} />}
          </button>
          {showPrompt && (
            <div className="mt-2">
              <div className="flex justify-end mb-1">
                <button
                  onClick={copyPrompt}
                  className="flex items-center gap-1 text-[10px] text-slate-400 hover:text-slate-200"
                >
                  {promptCopied ? <Check size={10} className="text-green-400" /> : <Copy size={10} />}
                  {promptCopied ? 'Скопировано' : 'Копировать'}
                </button>
              </div>
              <pre className="text-[10px] font-mono text-slate-400 bg-slate-900 rounded-lg p-2 overflow-auto max-h-48 whitespace-pre-wrap">
                {systemPrompt}
              </pre>
            </div>
          )}
        </div>

        {/* Messages */}
        <div className="flex-1 overflow-y-auto px-4 py-3 flex flex-col gap-3 min-h-0">
          {messages.length === 0 && (
            <div className="flex flex-col items-center justify-center h-full gap-4 text-center">
              <div className="w-16 h-16 rounded-2xl bg-violet-600/10 border border-violet-500/20 flex items-center justify-center">
                <Sparkles size={28} className="text-violet-400" />
              </div>
              <div>
                <div className="text-sm font-semibold text-slate-300 mb-1">Опишите задачу</div>
                <div className="text-xs text-slate-500 max-w-64">
                  Напишите что хотите сделать с данными — AI создаст пайплайн автоматически
                </div>
              </div>
              <div className="text-[10px] text-slate-600 bg-slate-800/50 rounded-xl px-3 py-2 max-w-xs">
                Для работы нужен запущенный локальный LLM.<br />
                Нажмите ⚙️ для настройки подключения.
              </div>
            </div>
          )}

          {messages.map(msg => (
            <MessageBubble
              key={msg.id}
              msg={msg}
              onApply={(steps) => applySteps(steps, true)}
              onAppend={(steps) => applySteps(steps, false)}
            />
          ))}
          <div ref={messagesEndRef} />
        </div>

        {/* Input */}
        <div className="px-4 py-3 border-t border-slate-700 flex-shrink-0">
          <div className="flex gap-2 items-end">
            <textarea
              ref={inputRef}
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  sendMessage();
                }
              }}
              placeholder="Опишите задачу... (Enter — отправить, Shift+Enter — новая строка)"
              rows={2}
              className="flex-1 bg-slate-800 border border-slate-700 rounded-xl px-3 py-2 text-sm text-slate-200 placeholder-slate-600 focus:border-violet-500 focus:outline-none resize-none"
            />
            {isLoading ? (
              <button
                onClick={cancelRequest}
                className="flex-shrink-0 w-9 h-9 flex items-center justify-center rounded-xl bg-red-600 hover:bg-red-500 text-white transition-colors"
                title="Отменить запрос"
              >
                <X size={14} />
              </button>
            ) : (
              <button
                onClick={sendMessage}
                disabled={!input.trim()}
                className="flex-shrink-0 w-9 h-9 flex items-center justify-center rounded-xl bg-violet-600 hover:bg-violet-500 disabled:bg-slate-700 disabled:text-slate-500 text-white transition-colors"
              >
                {isLoading ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
              </button>
            )}
          </div>
          <div className="mt-1.5 flex items-center gap-2 text-[10px] text-slate-600">
            <RotateCcw size={9} />
            Контекст: {messages.filter(m => m.role !== 'system').length} сообщений в истории
          </div>
        </div>
      </div>
    </div>
  );
}
