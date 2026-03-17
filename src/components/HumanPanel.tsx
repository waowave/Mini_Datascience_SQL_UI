import { BookOpen, Lightbulb } from 'lucide-react';
import { useStore } from '../store/useStore';
import { compiler } from '../engine/SQLCompiler';

const TIPS: Record<string, string[]> = {
  FROM: [
    'Это первый шаг — выбор таблицы с данными.',
    'Все остальные шаги будут работать с этой таблицей.',
  ],
  FILTER: [
    'Фильтр оставляет только нужные строки.',
    'Это как в Excel: Данные → Фильтр.',
    'Можно добавить несколько условий через И/ИЛИ.',
  ],
  JOIN: [
    'Объединение соединяет две таблицы по общему полю.',
    'Например: продажи + данные о менеджерах.',
    'INNER: только совпадающие. LEFT: все из первой таблицы.',
  ],
  FORMULA: [
    'Создаёт новую колонку на основе формулы.',
    'Используйте [Название колонки] для ссылки на значения.',
    'Пример: [Цена] * [Количество] = выручка.',
  ],
  GROUP: [
    'Сводная таблица — группирует строки и считает итоги.',
    'Как сводная таблица в Excel.',
    'Выберите: по чему группировать и что считать.',
  ],
  SORT: [
    'Сортировка выстраивает строки по заданному порядку.',
    '▲ По возрастанию: 1, 2, 3 или А, Б, В.',
    '▼ По убыванию: 9, 8, 7 или Я, Э, Ю.',
  ],
  RENAME: [
    'Переименовывает колонки для удобства.',
    'Оригинальная таблица не изменяется.',
  ],
  LIMIT: [
    'Ограничивает количество строк в результате.',
    'Полезно для предварительного просмотра больших данных.',
  ],
  SELECT: [
    'Выбирает только нужные колонки.',
    'Скрывает лишние данные из результата.',
  ],
};

export function HumanPanel() {
  const { pipelines, activeTabId, selectedStepId, grandmaMode } = useStore();
  const pipeline = pipelines.find(p => p.id === activeTabId);

  if (!pipeline) return null;

  const selectedStep = selectedStepId
    ? pipeline.steps.find(s => s.id === selectedStepId)
    : null;

  const compiled = compiler.compile(pipeline, grandmaMode);

  return (
    <div className="bg-slate-800/60 border-t border-slate-700 overflow-y-auto custom-scroll">
      {selectedStep ? (
        /* Selected step detail */
        <div className="p-3">
          <div className="flex items-center gap-2 mb-2">
            <Lightbulb size={13} className="text-yellow-400 flex-shrink-0" />
            <span className="text-xs font-semibold text-slate-300">
              {grandmaMode ? 'Что делает этот шаг?' : 'Step Info'}
            </span>
          </div>
          <p className="text-xs text-slate-300 leading-relaxed mb-2">
            {compiled.humanSteps[pipeline.steps.indexOf(selectedStep)] ?? '—'}
          </p>
          <div className="space-y-1 mt-2">
            {(TIPS[selectedStep.type] ?? []).map((tip, i) => (
              <p key={i} className="text-xs text-slate-500 flex items-start gap-1.5">
                <span className="text-slate-600 mt-0.5">•</span>
                {tip}
              </p>
            ))}
          </div>
        </div>
      ) : (
        /* Overall pipeline summary */
        <div className="p-3">
          <div className="flex items-center gap-2 mb-2">
            <BookOpen size={13} className="text-blue-400 flex-shrink-0" />
            <span className="text-xs font-semibold text-slate-300">
              {grandmaMode ? 'Описание запроса' : 'Pipeline Summary'}
            </span>
          </div>
          {compiled.humanSteps.length === 0 ? (
            <p className="text-xs text-slate-600 italic">Добавьте шаги в пайплайн</p>
          ) : (
            <ol className="space-y-1">
              {compiled.humanSteps.map((h, i) => (
                <li key={i} className="text-xs text-slate-400 flex items-start gap-2">
                  <span className="text-slate-600 flex-shrink-0 tabular-nums">{i + 1}.</span>
                  <span>{h}</span>
                </li>
              ))}
            </ol>
          )}
        </div>
      )}
    </div>
  );
}
