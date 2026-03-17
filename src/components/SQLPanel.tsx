import { X, Copy, Check } from 'lucide-react';
import { useState } from 'react';
import { useStore } from '../store/useStore';
import { compiler } from '../engine/SQLCompiler';

export function SQLPanel() {
  const { pipelines, activeTabId, sqlPanelOpen, toggleSqlPanel, grandmaMode } = useStore();
  const [copied, setCopied] = useState(false);

  if (!sqlPanelOpen) return null;

  const pipeline = pipelines.find(p => p.id === activeTabId);
  if (!pipeline) return null;

  const { sql, humanSteps, error } = compiler.compile(pipeline, grandmaMode);

  const copy = () => {
    navigator.clipboard.writeText(sql).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  return (
    <div className="h-full flex flex-col bg-slate-900 border-t border-slate-700">
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-2 border-b border-slate-700 flex-shrink-0 bg-slate-800/80">
        <span className="text-sm font-semibold text-slate-200">
          {grandmaMode ? '📝 SQL-код вашего запроса' : '⚡ Generated SQL'}
        </span>
        {grandmaMode && (
          <span className="text-xs text-slate-500 ml-1">
            (Этот код выполняется в базе данных)
          </span>
        )}
        <div className="ml-auto flex items-center gap-2">
          <button
            onClick={copy}
            className="flex items-center gap-1.5 px-3 py-1 rounded-lg text-xs border border-slate-600 text-slate-400 hover:border-slate-500 hover:text-slate-300 transition-colors"
          >
            {copied ? <Check size={12} className="text-green-400" /> : <Copy size={12} />}
            {copied ? 'Скопировано!' : 'Копировать'}
          </button>
          <button
            onClick={toggleSqlPanel}
            className="p-1 text-slate-500 hover:text-slate-300 transition-colors"
          >
            <X size={16} />
          </button>
        </div>
      </div>

      <div className="flex flex-1 overflow-hidden min-h-0">
        {/* SQL Code */}
        <div className="flex-1 overflow-auto custom-scroll p-4 min-w-0">
          {error ? (
            <div className="text-red-400 text-sm">{error}</div>
          ) : (
            <pre className="text-sm font-mono text-slate-300 whitespace-pre-wrap leading-relaxed">
              <SQLHighlight sql={sql} />
            </pre>
          )}
        </div>

        {/* Human explanation */}
        <div className="w-72 border-l border-slate-700 overflow-y-auto custom-scroll p-3 flex-shrink-0">
          <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3">
            {grandmaMode ? '📖 Что происходит' : 'Step Breakdown'}
          </p>
          <div className="space-y-2">
            {humanSteps.map((h, i) => (
              <div key={i} className="flex gap-2 text-xs">
                <span className="text-slate-600 flex-shrink-0 tabular-nums">{i + 1}.</span>
                <span className="text-slate-300 leading-relaxed">{h}</span>
              </div>
            ))}
          </div>
          {humanSteps.length === 0 && (
            <p className="text-xs text-slate-600 italic">Нет активных шагов</p>
          )}
        </div>
      </div>
    </div>
  );
}

// Simple SQL syntax highlighter
function SQLHighlight({ sql }: { sql: string }) {
  const keywords = [
    'WITH', 'SELECT', 'FROM', 'WHERE', 'AND', 'OR', 'NOT',
    'JOIN', 'LEFT', 'RIGHT', 'INNER', 'OUTER', 'FULL', 'ON',
    'GROUP BY', 'ORDER BY', 'HAVING', 'LIMIT', 'OFFSET',
    'AS', 'IN', 'IS', 'NULL', 'LIKE', 'BETWEEN', 'CASE', 'WHEN', 'THEN', 'ELSE', 'END',
    'SUM', 'AVG', 'COUNT', 'MIN', 'MAX', 'DISTINCT',
    'ASC', 'DESC', 'CURRENT_DATE', 'NOW',
  ];

  const parts: { text: string; type: 'keyword' | 'string' | 'number' | 'comment' | 'cte' | 'plain' }[] = [];
  let remaining = sql;

  while (remaining.length > 0) {
    // Comments
    if (remaining.startsWith('--')) {
      const end = remaining.indexOf('\n');
      const comment = end === -1 ? remaining : remaining.slice(0, end + 1);
      parts.push({ text: comment, type: 'comment' });
      remaining = remaining.slice(comment.length);
      continue;
    }
    // String literals
    if (remaining.startsWith("'")) {
      const match = remaining.match(/^'[^']*'/);
      if (match) {
        parts.push({ text: match[0], type: 'string' });
        remaining = remaining.slice(match[0].length);
        continue;
      }
    }
    // Numbers
    const numMatch = remaining.match(/^\d+(\.\d+)?/);
    if (numMatch && (remaining.length === numMatch[0].length || !/\w/.test(remaining[numMatch[0].length]))) {
      parts.push({ text: numMatch[0], type: 'number' });
      remaining = remaining.slice(numMatch[0].length);
      continue;
    }
    // Keywords (try longest first with GROUP BY, ORDER BY)
    let matched = false;
    for (const kw of keywords.sort((a, b) => b.length - a.length)) {
      if (remaining.toUpperCase().startsWith(kw)) {
        const after = remaining[kw.length];
        if (!after || /[\s,()\n]/.test(after)) {
          parts.push({ text: remaining.slice(0, kw.length), type: 'keyword' });
          remaining = remaining.slice(kw.length);
          matched = true;
          break;
        }
      }
    }
    if (matched) continue;

    // CTE names (step_N)
    const cteMatch = remaining.match(/^step_\d+/);
    if (cteMatch) {
      parts.push({ text: cteMatch[0], type: 'cte' });
      remaining = remaining.slice(cteMatch[0].length);
      continue;
    }

    // Plain char
    parts.push({ text: remaining[0], type: 'plain' });
    remaining = remaining.slice(1);
  }

  return (
    <>
      {parts.map((p, i) => {
        switch (p.type) {
          case 'keyword': return <span key={i} className="text-blue-400 font-semibold">{p.text}</span>;
          case 'string': return <span key={i} className="text-green-400">{p.text}</span>;
          case 'number': return <span key={i} className="text-amber-400">{p.text}</span>;
          case 'comment': return <span key={i} className="text-slate-500 italic">{p.text}</span>;
          case 'cte': return <span key={i} className="text-purple-400">{p.text}</span>;
          default: return <span key={i}>{p.text}</span>;
        }
      })}
    </>
  );
}
