import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Search, X } from 'lucide-react';
import { cn } from '@/lib/utils';

function norm(value) {
  return String(value || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}/gu, '');
}

/**
 * Search input with live suggestions from a local items list.
 *
 * getItem(item) => { id, title, subtitle?, filterValue? }
 * - title/subtitle: shown in dropdown
 * - filterValue: applied to onChange when a suggestion is picked (defaults to title)
 */
export default function SuggestSearch({
  value,
  onChange,
  items = [],
  getItem,
  placeholder = 'Caută...',
  className,
  inputClassName,
  maxSuggestions = 8,
  emptyText = 'Niciun rezultat',
  onSelect,
}) {
  const rootRef = useRef(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const onDocClick = (e) => {
      if (rootRef.current && !rootRef.current.contains(e.target)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, []);

  const suggestions = useMemo(() => {
    const q = norm(value).trim();
    if (!q || !getItem) return [];

    const out = [];
    for (const raw of items) {
      const item = getItem(raw);
      if (!item) continue;
      const hay = norm([item.title, item.subtitle, item.filterValue, item.searchText].filter(Boolean).join(' '));
      if (!hay.includes(q)) continue;
      out.push({ raw, ...item });
      if (out.length >= maxSuggestions) break;
    }
    return out;
  }, [value, items, getItem, maxSuggestions]);

  const showPanel = open && norm(value).trim().length > 0;

  const pick = (item) => {
    const next = item.filterValue ?? item.title ?? '';
    onChange?.(next);
    onSelect?.(item);
    setOpen(false);
  };

  return (
    <div ref={rootRef} className={cn('relative', className)}>
      <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none z-10" />
      <input
        type="text"
        role="searchbox"
        value={value}
        autoComplete="off"
        placeholder={placeholder}
        className={cn(
          'w-full pl-9 pr-9 py-2 text-sm bg-white border border-slate-200 rounded-lg focus:outline-none focus:border-[#1D4E89] transition-colors',
          inputClassName
        )}
        onChange={(e) => {
          onChange?.(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            setOpen(false);
            e.currentTarget.blur();
          }
          if (e.key === 'Enter' && suggestions[0]) {
            e.preventDefault();
            pick(suggestions[0]);
          }
        }}
      />
      {value && (
        <button
          type="button"
          className="absolute right-2 top-1/2 -translate-y-1/2 p-1 rounded text-slate-400 hover:text-slate-600"
          onClick={() => {
            onChange?.('');
            setOpen(false);
          }}
          aria-label="Șterge căutarea"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      )}

      {showPanel && (
        <div className="absolute left-0 right-0 top-full mt-1.5 z-50 bg-white rounded-xl border border-slate-200 shadow-lg overflow-hidden max-h-72 overflow-y-auto">
          {suggestions.length === 0 ? (
            <p className="px-4 py-5 text-sm text-slate-500 text-center">
              {emptyText}{value.trim() ? ` pentru „${value.trim()}”` : ''}
            </p>
          ) : (
            <ul className="py-1">
              {suggestions.map((item) => (
                <li key={item.id}>
                  <button
                    type="button"
                    className="w-full text-left px-4 py-2.5 hover:bg-slate-50"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => pick(item)}
                  >
                    <span className="block text-sm font-medium text-slate-800 truncate">{item.title}</span>
                    {item.subtitle && (
                      <span className="block text-xs text-slate-500 truncate">{item.subtitle}</span>
                    )}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
