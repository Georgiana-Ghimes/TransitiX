import React, { useEffect, useState } from 'react';
import { Minus, Plus } from 'lucide-react';

/** Fit-width multipliers for aviz document preview panes. */
export const PREVIEW_ZOOM_STEPS = [0.75, 1, 1.25, 1.5, 2];

export const previewZoomBtnCls =
  'inline-flex items-center gap-1 px-2 py-0.5 rounded border border-slate-300 bg-white text-slate-700 hover:bg-slate-50 disabled:opacity-50';

export function stepPreviewZoom(current, direction) {
  const idx = PREVIEW_ZOOM_STEPS.findIndex((z) => z === current);
  const at = idx >= 0 ? idx : PREVIEW_ZOOM_STEPS.indexOf(1);
  const next = at + direction;
  if (next < 0 || next >= PREVIEW_ZOOM_STEPS.length) return current;
  return PREVIEW_ZOOM_STEPS[next];
}

/**
 * Image preview box size: same fit-width model as PdfCanvasViewer.
 * Do not use CSS `transform: scale` + inverse width — on phone screenshots that made
 * 75% paint like a heavy zoom-in while the label said 75%.
 */
export function imagePreviewZoomStyle(zoom) {
  const z = Number.isFinite(Number(zoom)) && Number(zoom) > 0 ? Number(zoom) : 1;
  if (z === 1) return { width: '100%', maxWidth: '100%' };
  return { width: `${z * 100}%`, maxWidth: 'none' };
}

/** Zoom state that resets when the document (or glued set) changes. */
export function usePreviewZoom(resetKey) {
  const [zoom, setZoom] = useState(1);
  useEffect(() => {
    setZoom(1);
  }, [resetKey]);
  const zoomAtMin = zoom <= PREVIEW_ZOOM_STEPS[0];
  const zoomAtMax = zoom >= PREVIEW_ZOOM_STEPS[PREVIEW_ZOOM_STEPS.length - 1];
  return {
    zoom,
    setZoom,
    zoomAtMin,
    zoomAtMax,
    zoomOut: () => setZoom((z) => stepPreviewZoom(z, -1)),
    zoomIn: () => setZoom((z) => stepPreviewZoom(z, 1)),
  };
}

/**
 * +/- controls for AvizFilePreview `zoom`. Same control in Editează, Verificare OCR
 * and Confirmă selectate.
 */
export default function AvizPreviewZoomBar({
  zoom,
  onZoomOut,
  onZoomIn,
  zoomAtMin = false,
  zoomAtMax = false,
  className = '',
}) {
  return (
    <span className={`inline-flex items-center gap-1 shrink-0 ${className}`.trim()}>
      <button
        type="button"
        disabled={zoomAtMin}
        onClick={onZoomOut}
        className={previewZoomBtnCls}
        title="Micșorează"
        aria-label="Micșorează"
      >
        <Minus className="w-3.5 h-3.5" />
      </button>
      <span
        className="min-w-[2.75rem] text-center tabular-nums text-slate-700 text-[11px] normal-case tracking-normal font-normal"
        title="Zoom față de lățimea panoului"
      >
        {Math.round(Number(zoom) * 100)}%
      </span>
      <button
        type="button"
        disabled={zoomAtMax}
        onClick={onZoomIn}
        className={previewZoomBtnCls}
        title="Mărește"
        aria-label="Mărește"
      >
        <Plus className="w-3.5 h-3.5" />
      </button>
    </span>
  );
}
