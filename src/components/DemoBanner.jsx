import React from 'react';
import { AlertTriangle } from 'lucide-react';

/** Honest label for GPS / Planning / e-Factura — not live ANAF or telematics. */
export default function DemoBanner({ title, children }) {
  return (
    <div
      role="status"
      className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-950"
    >
      <p className="font-medium flex items-start gap-2">
        <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5 text-amber-700" />
        <span>{title}</span>
      </p>
      {children ? <p className="mt-1 pl-6 text-amber-900/90">{children}</p> : null}
    </div>
  );
}
