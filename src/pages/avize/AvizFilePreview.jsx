import React, { useEffect, useRef, useState } from 'react';
import { previewKind } from '@/lib/avizOps';
import { containedRect } from '@/lib/ocrBlocks';
import { fetchUploadBlob, withAccessToken } from '@/lib/uploadUrl';

const SOURCE_LABEL = {
  driver_manual: 'Manual șofer',
  'driver-manual': 'Manual șofer',
  // `none` is what the extractor stores when a read failed. Without a label the badge printed
  // the raw column value at the operator.
  none: 'Fără OCR',
};

const SOURCE_TONE = {
  driver_manual: 'bg-emerald-50 text-emerald-800',
  'driver-manual': 'bg-emerald-50 text-emerald-800',
  none: 'bg-rose-50 text-rose-800',
};

/** Engine / provider names stay off the office list - the customer does not need to know how the page was read. */
const HIDDEN_SOURCES = new Set([
  'pdf-text', 'mistral', 'vision', 'paddle', 'paddle-vl', 'stub',
]);

export function SourceBadge({ source }) {
  if (!source) return null;
  const key = String(source).replace(/_/g, '-');
  if (HIDDEN_SOURCES.has(key) || HIDDEN_SOURCES.has(source)) return null;
  const tone = SOURCE_TONE[key] || SOURCE_TONE[source];
  const label = SOURCE_LABEL[key] || SOURCE_LABEL[source];
  if (!label) return null;
  return (
    <span className={`inline-block text-[11px] px-2 py-0.5 rounded-full ${tone}`}>
      {label}
    </span>
  );
}

/** Marks paperwork photographed in the cab vs scanned at the office. */
export function DriverUploadBadge({ uploadedFrom }) {
  if (uploadedFrom !== 'driver') return null;
  return (
    <span className="inline-block text-[11px] px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-800">
      De la șofer
    </span>
  );
}

/** OCR finished but confidence/fields still need a human eye. */
export function NeedsReviewBadge({ needsReview, routing }) {
  if (!needsReview && routing !== 'hitl_required' && routing !== 'hitl_optional') return null;
  const label = routing === 'hitl_required'
    ? 'Verificare obligatorie'
    : routing === 'hitl_optional'
      ? 'De revizuit'
      : 'De revizuit';
  return (
    <span className="inline-block text-[11px] px-2 py-0.5 rounded-full bg-amber-50 text-amber-800">
      {label}
    </span>
  );
}

const PREVIEW_FRAME_FIXED =
  'w-full border-0 bg-white min-h-[240px] h-[36vh] max-h-[420px] object-contain';
const PREVIEW_FRAME_FILL =
  'absolute inset-0 w-full h-full border-0 bg-slate-100 object-contain';

/**
 * @param {object} props
 * @param {string} props.fileUrl
 * @param {boolean} [props.fill]
 * @param {(ctx: {naturalWidth: number, naturalHeight: number}) => React.ReactNode} [props.overlay]
 *   Rendered on top of an *image* preview, in a box that hugs the rendered picture exactly
 *   (so percentage-positioned children land on the page, not in the letterbox). Ignored for
 *   PDFs - an iframe cannot be drawn over.
 */
export default function AvizFilePreview({ fileUrl, fill = false, overlay = null }) {
  const [src, setSrc] = useState('');
  const [error, setError] = useState('');
  const [natural, setNatural] = useState(null);
  const [boxSize, setBoxSize] = useState(null);
  const boxRef = useRef(null);
  const kind = previewKind(fileUrl);
  const frame = fill ? PREVIEW_FRAME_FILL : PREVIEW_FRAME_FIXED;
  const wantsOverlay = Boolean(overlay) && kind === 'image';

  // The overlay has to sit on the picture, not on the box around it. `object-contain`
  // letterboxes, so the picture's rectangle is computed from the box size and the natural
  // size - and recomputed when the box changes (drawer resize, phone rotation).
  useEffect(() => {
    if (!wantsOverlay || !src) return undefined;
    const el = boxRef.current;
    if (!el) return undefined;
    const update = () => setBoxSize({ width: el.clientWidth, height: el.clientHeight });
    update();
    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', update);
      return () => window.removeEventListener('resize', update);
    }
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, [wantsOverlay, src]);

  useEffect(() => {
    let objectUrl = '';
    let cancelled = false;
    setSrc('');
    setError('');
    setNatural(null);

    if (!fileUrl) {
      setError('Nu există fișier atașat acestui aviz.');
      return undefined;
    }

    // Manual cab entry - no bytes on disk.
    if (String(fileUrl).startsWith('manual://')) {
      setError('Aviz completat manual de șofer - fără fișier atașat.');
      return undefined;
    }

    const tokenUrl = withAccessToken(fileUrl);

    (async () => {
      try {
        const blob = await fetchUploadBlob(fileUrl);
        if (cancelled) return;
        if (blob) {
          objectUrl = URL.createObjectURL(blob);
          setSrc(objectUrl);
          return;
        }
        // Bearer fetch failed (proxy/session), query-token URL still works for <img>/<iframe>.
        if (tokenUrl && tokenUrl !== fileUrl) {
          setSrc(tokenUrl);
          return;
        }
        setError('Nu am putut încărca documentul. Reautentifică-te și încearcă din nou.');
      } catch {
        if (cancelled) return;
        if (tokenUrl && tokenUrl !== fileUrl) {
          setSrc(tokenUrl);
          return;
        }
        setError('Nu am putut încărca documentul. Reautentifică-te și încearcă din nou.');
      }
    })();

    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [fileUrl]);

  const isManualPlaceholder = String(fileUrl || '').startsWith('manual://');
  const openUrl = !isManualPlaceholder && (src || withAccessToken(fileUrl));

  if (error) {
    return (
      <div
        className={`${
          fill ? 'absolute inset-0' : 'w-full min-h-[240px] h-[36vh] max-h-[420px]'
        } flex flex-col items-center justify-center gap-3 p-6`}
      >
        <p className="max-w-sm text-center text-sm leading-relaxed text-amber-800">
          {error}
        </p>
        {openUrl ? (
          <a
            href={openUrl}
            target="_blank"
            rel="noreferrer"
            className="text-xs text-sky-700 hover:underline"
          >
            Deschide documentul într-un tab nou
          </a>
        ) : null}
      </div>
    );
  }

  if (!src) {
    return (
      <p className={`text-xs text-slate-500 p-4 ${fill ? 'absolute inset-0 flex items-center' : ''}`}>
        Se încarcă preview…
      </p>
    );
  }

  if (kind === 'pdf') {
    return (
      <iframe title="Previzualizare aviz" className={frame} src={src} />
    );
  }
  if (wantsOverlay) {
    const rect = natural && boxSize
      ? containedRect(boxSize.width, boxSize.height, natural.naturalWidth, natural.naturalHeight)
      : null;
    return (
      <div
        ref={boxRef}
        className={`${fill ? 'absolute inset-0' : 'relative w-full min-h-[240px] h-[36vh] max-h-[420px]'} bg-slate-100 overflow-hidden`}
      >
        <img
          alt="Aviz"
          className="absolute inset-0 w-full h-full object-contain"
          src={src}
          onLoad={(e) => setNatural({ naturalWidth: e.currentTarget.naturalWidth, naturalHeight: e.currentTarget.naturalHeight })}
        />
        {rect ? (
          <div
            className="absolute pointer-events-none"
            style={{ left: rect.left, top: rect.top, width: rect.width, height: rect.height }}
          >
            {overlay(natural)}
          </div>
        ) : null}
      </div>
    );
  }
  if (kind === 'image') {
    return <img alt="Aviz" className={frame} src={src} />;
  }

  return (
    <div className={`${fill ? 'absolute inset-0 flex flex-col justify-center' : ''} p-4 space-y-2`}>
      <p className="text-xs text-slate-500">Nu există preview pentru acest tip de fișier.</p>
      <a href={src} target="_blank" rel="noreferrer" className="text-xs text-sky-700 hover:underline">
        Deschide fișierul
      </a>
    </div>
  );
}
