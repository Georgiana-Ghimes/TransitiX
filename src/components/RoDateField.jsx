import React, { useEffect, useState } from 'react';
import { Calendar as CalendarIcon } from 'lucide-react';
import { Calendar } from '@/components/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import {
  formatDate,
  isoToLocalDate,
  localDateToIso,
  parseRoDateInput,
  toDateIso,
} from '@/lib/utils';

/**
 * Date field that always shows DD.MM.YYYY (RO), stores YYYY-MM-DD.
 * Avoids native <input type="date"> which follows OS locale (en-US → MM/DD).
 */
export default function RoDateField({
  value = '',
  onChange,
  className = '',
  id,
  name,
  disabled = false,
  'aria-label': ariaLabel,
}) {
  const iso = toDateIso(value);
  const [text, setText] = useState(iso ? formatDate(iso) : '');
  const [open, setOpen] = useState(false);

  useEffect(() => {
    setText(iso ? formatDate(iso) : '');
  }, [iso]);

  const commitText = (raw) => {
    const parsed = parseRoDateInput(raw);
    if (parsed === null) {
      setText(iso ? formatDate(iso) : '');
      return;
    }
    setText(parsed ? formatDate(parsed) : '');
    if (parsed !== iso) onChange?.(parsed);
  };

  const pickDay = (day) => {
    if (!day) return;
    const next = localDateToIso(day);
    setText(formatDate(next));
    onChange?.(next);
    setOpen(false);
  };

  return (
    <div className="flex gap-1.5 items-stretch">
      <input
        id={id}
        name={name}
        type="text"
        inputMode="numeric"
        autoComplete="off"
        placeholder="ZZ.LL.AAAA"
        disabled={disabled}
        aria-label={ariaLabel || 'Dată (ZZ.LL.AAAA)'}
        className={className}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onBlur={(e) => commitText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            commitText(e.currentTarget.value);
          }
        }}
      />
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button
            type="button"
            disabled={disabled}
            aria-label="Alege data din calendar"
            className="shrink-0 inline-flex items-center justify-center w-10 rounded-lg border border-slate-200 bg-white text-slate-600 hover:bg-slate-50 disabled:opacity-50"
          >
            <CalendarIcon className="w-4 h-4" />
          </button>
        </PopoverTrigger>
        <PopoverContent className="w-auto p-0" align="end">
          <Calendar
            mode="single"
            selected={isoToLocalDate(iso)}
            defaultMonth={isoToLocalDate(iso)}
            onSelect={pickDay}
            initialFocus
          />
        </PopoverContent>
      </Popover>
    </div>
  );
}
