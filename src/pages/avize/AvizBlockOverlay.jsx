import React from 'react';
import { blockRect, isLowConfidenceBlock } from '@/lib/ocrBlocks';

/**
 * Draws OCR layout blocks over the rendered page.
 *
 * - `highlight`: blocks matched to the field the operator is on — solid blue.
 * - low-confidence blocks — amber, so a doubtful read is visible even when no field points at it.
 * - everything else — only when `showAll`, a faint outline for orientation.
 *
 * Clicking a block hands its text to `onPick`; the drawer uses that to fill the active
 * field without retyping. The parent sets `pointer-events-none` on the container, so only the
 * boxes themselves are clickable and the picture stays scrollable underneath.
 */
export default function AvizBlockOverlay({
  blocks, page = 0, natural, highlight = [], showAll = false, onPick,
}) {
  const list = (Array.isArray(blocks) ? blocks : []).filter((b) => (b.page ?? 0) === page);
  const hot = new Set(highlight);
  const fallback = { width: natural?.naturalWidth, height: natural?.naturalHeight };

  return (
    <>
      {list.map((block, idx) => {
        const rect = blockRect(block, fallback);
        if (!rect) return null;
        const isHot = hot.has(block);
        const isLow = isLowConfidenceBlock(block);
        if (!isHot && !isLow && !showAll) return null;
        const tone = isHot
          ? 'border-sky-500 bg-sky-400/20 ring-1 ring-sky-300'
          : isLow
            ? 'border-amber-500 bg-amber-300/20'
            : 'border-slate-600/70 bg-white/10';
        const label = `${block.text || ''}${block.confidence != null ? ` · ${Math.round(block.confidence * 100)}%` : ''}`;
        return (
          <button
            type="button"
            key={`${block.page}-${idx}`}
            title={label}
            aria-label={`Bloc OCR: ${label}`}
            onClick={onPick ? () => onPick(block) : undefined}
            className={`absolute border rounded-sm pointer-events-auto cursor-pointer transition-colors hover:bg-sky-400/30 ${tone}`}
            style={{
              left: `${rect.left}%`,
              top: `${rect.top}%`,
              width: `${rect.width}%`,
              height: `${rect.height}%`,
            }}
          />
        );
      })}
    </>
  );
}
