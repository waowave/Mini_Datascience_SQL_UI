import { useState, useRef } from 'react';
import {
  ChevronDown, ChevronRight, Trash2, EyeOff, Eye,
  GripVertical, MessageSquare, Check, X,
} from 'lucide-react';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { useStore } from '../store/useStore';
import { stepToHuman } from '../engine/SQLCompiler';
import type { Step } from '../types';

const STEP_COLORS: Record<string, string> = {
  FROM: 'bg-blue-500',
  FILTER: 'bg-amber-500',
  JOIN: 'bg-purple-500',
  FORMULA: 'bg-green-500',
  GROUP: 'bg-rose-500',
  SORT: 'bg-cyan-500',
  RENAME: 'bg-orange-400',
  LIMIT: 'bg-slate-500',
  SELECT: 'bg-indigo-500',
};

const STEP_LABELS_NORMAL: Record<string, string> = {
  FROM: 'Источник', FILTER: 'Фильтр', JOIN: 'Объединение',
  FORMULA: 'Формула', GROUP: 'Группировка', SORT: 'Сортировка',
  RENAME: 'Переименование', LIMIT: 'Лимит', SELECT: 'Выбор колонок',
};

const STEP_LABELS_GRANDMA: Record<string, string> = {
  FROM: 'Открыть таблицу', FILTER: 'Фильтр (Отбор)', JOIN: 'Приклеить таблицу',
  FORMULA: 'Новая колонка', GROUP: 'Сводка (Итого)', SORT: 'Сортировка',
  RENAME: 'Переименование', LIMIT: 'Ограничить', SELECT: 'Выбрать колонки',
};

interface StepCardProps {
  step: Step;
  pipelineId: string;
  index: number;
  isSelected: boolean;
  onDoubleClick: () => void; // opens editor
}

export function StepCard({ step, pipelineId, index, isSelected, onDoubleClick }: StepCardProps) {
  const { removeStep, toggleStepActive, updateStep, setSelectedStep, grandmaMode } = useStore();
  const [editingComment, setEditingComment] = useState(false);
  const [commentDraft, setCommentDraft] = useState(step.uiMeta.comment);
  const clickTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: step.id });
  const style = { transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.5 : 1 };

  const isActive = step.uiMeta.isActive;
  const color = STEP_COLORS[step.type] ?? 'bg-slate-500';
  const label = grandmaMode ? STEP_LABELS_GRANDMA[step.type] : STEP_LABELS_NORMAL[step.type];
  const human = stepToHuman(step, grandmaMode);

  const toggleCollapse = () => {
    updateStep(pipelineId, step.id, {
      uiMeta: { ...step.uiMeta, isCollapsed: !step.uiMeta.isCollapsed },
    });
  };

  const saveComment = () => {
    updateStep(pipelineId, step.id, {
      uiMeta: { ...step.uiMeta, comment: commentDraft },
    });
    setEditingComment(false);
  };

  // Single click = select, Double click = open editor (300ms delay to distinguish)
  const handleClick = () => {
    if (clickTimerRef.current) {
      clearTimeout(clickTimerRef.current);
      clickTimerRef.current = null;
      // This is the second click — double click
      setSelectedStep(step.id);
      onDoubleClick();
      return;
    }
    clickTimerRef.current = setTimeout(() => {
      clickTimerRef.current = null;
      setSelectedStep(isSelected ? null : step.id);
    }, 220);
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`rounded-xl border-2 transition-all select-none mb-2 ${
        isSelected
          ? 'border-blue-400 shadow-lg shadow-blue-500/20 bg-slate-800'
          : 'border-slate-700 bg-slate-800/60 hover:border-slate-500'
      } ${!isActive ? 'opacity-50' : ''}`}
    >
      {/* Header */}
      <div
        className="flex items-center gap-2 p-2.5 cursor-pointer"
        onClick={handleClick}
      >
        {/* Drag handle */}
        <div
          {...attributes}
          {...listeners}
          className="cursor-grab text-slate-500 hover:text-slate-300 flex-shrink-0"
          onClick={(e) => e.stopPropagation()}
        >
          <GripVertical size={14} />
        </div>

        {/* Step index badge */}
        <div className={`w-5 h-5 rounded-full ${color} flex items-center justify-center text-white text-[10px] font-bold flex-shrink-0`}>
          {index + 1}
        </div>

        {/* Type label */}
        <span className="text-xs font-semibold text-slate-200 flex-1 truncate">{label}</span>

        {/* Actions */}
        <div className="flex items-center gap-0.5" onClick={(e) => e.stopPropagation()}>
          {/* Edit button */}
          <button
            className="p-1 text-slate-500 hover:text-blue-400 transition-colors"
            onClick={() => { setSelectedStep(step.id); onDoubleClick(); }}
            title="Редактировать шаг (или двойной клик)"
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
              <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
            </svg>
          </button>
          <button
            className="p-1 text-slate-500 hover:text-yellow-400 transition-colors"
            onClick={() => toggleStepActive(pipelineId, step.id)}
            title={isActive ? 'Выключить' : 'Включить'}
          >
            {isActive ? <Eye size={13} /> : <EyeOff size={13} />}
          </button>
          <button
            className="p-1 text-slate-500 hover:text-slate-300 transition-colors"
            onClick={() => { setCommentDraft(step.uiMeta.comment); setEditingComment(true); }}
            title="Комментарий"
          >
            <MessageSquare size={13} />
          </button>
          <button
            className="p-1 text-slate-500 hover:text-red-400 transition-colors"
            onClick={() => removeStep(pipelineId, step.id)}
            title="Удалить"
          >
            <Trash2 size={13} />
          </button>
          <button
            className="p-1 text-slate-500 hover:text-slate-200 transition-colors"
            onClick={toggleCollapse}
          >
            {step.uiMeta.isCollapsed ? <ChevronRight size={13} /> : <ChevronDown size={13} />}
          </button>
        </div>
      </div>

      {/* Body */}
      {!step.uiMeta.isCollapsed && (
        <div className="px-3 pb-2.5 border-t border-slate-700/50">
          <p className="text-xs text-slate-400 mt-2 leading-relaxed">{human}</p>
          {/* Hint: double click to edit */}
          <p className="text-[10px] text-slate-600 mt-1">
            Двойной клик или <span className="text-blue-500">✏</span> — редактировать
          </p>

          {/* Comment editing */}
          {editingComment ? (
            <div className="mt-2 flex gap-1" onClick={(e) => e.stopPropagation()}>
              <input
                autoFocus
                className="flex-1 text-xs bg-slate-700 border border-slate-600 rounded px-2 py-1 text-slate-200 outline-none focus:border-blue-500"
                value={commentDraft}
                onChange={(e) => setCommentDraft(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') saveComment(); if (e.key === 'Escape') setEditingComment(false); }}
                placeholder="Комментарий к шагу..."
              />
              <button onClick={saveComment} className="p-1 text-green-400"><Check size={13} /></button>
              <button onClick={() => setEditingComment(false)} className="p-1 text-red-400"><X size={13} /></button>
            </div>
          ) : step.uiMeta.comment ? (
            <div
              className="mt-1.5 flex items-start gap-1 text-xs text-slate-500 italic cursor-pointer hover:text-slate-400"
              onClick={(e) => { e.stopPropagation(); setCommentDraft(step.uiMeta.comment); setEditingComment(true); }}
            >
              <span className="text-[10px]">💬</span>
              <span>{step.uiMeta.comment}</span>
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
}
