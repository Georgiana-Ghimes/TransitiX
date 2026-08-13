import React from 'react';
import { AlertTriangle } from 'lucide-react';
import { cn } from '@/lib/utils';

/** Banner inside a modal/form — stays visible on mobile (unlike toasts under overlays). */
export function FormErrorBanner({ message, className }) {
  if (!message) return null;
  return (
    <div
      role="alert"
      className={cn(
        'flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2.5 text-sm text-red-700',
        className
      )}
    >
      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
      <p className="min-w-0 leading-snug">{message}</p>
    </div>
  );
}

export function FieldError({ message, id }) {
  if (!message) return null;
  return (
    <p id={id} className="mt-1 text-xs font-medium text-red-600" role="alert">
      {message}
    </p>
  );
}

export function fieldInputClass(base, hasError) {
  return cn(
    base,
    hasError && 'border-red-400 focus:border-red-500 bg-red-50/40'
  );
}
