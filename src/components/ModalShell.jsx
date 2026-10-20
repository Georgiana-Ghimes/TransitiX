import React, { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { cn } from '@/lib/utils';

/**
 * Full-viewport modal shell (portaled to body) so the dim overlay
 * never leaves a gap above the sticky topbar / beside the sidebar.
 */
export default function ModalShell({
  children,
  onClose,
  panelClassName,
  labelledBy,
}) {
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKey = (e) => {
      if (e.key !== 'Escape' || !onCloseRef.current) return;
      // Calendar / popover (portaled) already handled this key.
      if (e.defaultPrevented) return;
      onCloseRef.current();
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = prev;
      document.removeEventListener('keydown', onKey);
    };
  }, []);

  if (typeof document === 'undefined') return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center p-4 pt-[max(1rem,env(safe-area-inset-top))] pb-[max(1rem,env(safe-area-inset-bottom))]"
      role="presentation"
    >
      <div
        className="absolute inset-0 bg-black/50"
        aria-hidden="true"
        onClick={onClose}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelledBy}
        className={cn(
          // Default: scroll the whole panel. Callers that pass flex + overflow-hidden
          // (e.g. WhatsNew) keep a fixed header/footer with a scrollable body instead.
          'relative z-10 bg-white rounded-xl shadow-xl w-full max-h-[min(90dvh,90vh)] overflow-y-auto',
          panelClassName
        )}
        onClick={(e) => e.stopPropagation()}
      >
        {children}
      </div>
    </div>,
    document.body
  );
}
