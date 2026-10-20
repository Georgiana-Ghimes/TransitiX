import React, { useEffect, useRef, useState } from 'react';
import PdfCanvasViewer from '@/components/PdfCanvasViewer';
import { previewKind } from '@/lib/avizOps';
import { prepareImageForUpload } from '@/lib/imagePreprocess';
import { fetchUploadBlob, resolvePreviewSource, withAccessToken } from '@/lib/uploadUrl';
import { imagePreviewZoomStyle } from './AvizPreviewZoomBar';

/**
 * Bake EXIF + upright portrait for on-screen preview (#103).
 * Does not write the server file — 90°/180° in Editează still replace bytes on disk.
 *
 * Never use this path in Editează: preferPortrait re-scores 0/90/180/270 and can undo
 * the operator's rotate buttons (toast says rotated, preview looks the same).
 */
async function blobForUprightPreview(blob) {
  if (!blob || typeof File === 'undefined') return blob;
  try {
    const type = blob.type && String(blob.type).startsWith('image/')
      ? blob.type
      : 'image/jpeg';
    const file = new File([blob], 'aviz-preview.jpg', { type });
    const upright = await prepareImageForUpload(file, { preferPortrait: true });
    return upright instanceof Blob ? upright : blob;
  } catch {
    return blob;
  }
}

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

/** OCR finished but confidence/fields still need a human eye. Hidden once Confirmat. */
export function NeedsReviewBadge({ needsReview, routing, status }) {
  if (status === 'confirmed') return null;
  if (!needsReview && routing !== 'hitl_required' && routing !== 'hitl_optional') return null;
  const label = routing === 'hitl_required'
    ? 'Verificare obligatorie'
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
 * @param {string} [props.fileUrl]
 * @param {string[]} [props.fileUrls]  When set (and length > 1), pages from each file are
 *   stacked in one scroll — used for „Unește TPO” adjacent peers.
 * @param {boolean} [props.fill]
 * @param {number} [props.zoom]  Fit-width multiplier (1 = fit). PDFs re-render; images use CSS scale.
 * @param {boolean} [props.uprightPreview=true]  Auto EXIF + portrait score for display (#103).
 *   Set false in Editează so 90°/180° buttons show the file as stored on disk.
 * @param {(ctx: {naturalWidth: number, naturalHeight: number}) => React.ReactNode} [props.overlay]
 *   Rendered on top of an *image* preview, covering the fit-width picture (scroll with the
 *   page). PDFs are drawn on a canvas, so the overlay stays image-only.
 */
export default function AvizFilePreview({
  fileUrl,
  fileUrls = null,
  fill = false,
  zoom = 1,
  uprightPreview = true,
  overlay = null,
}) {
  const urls = Array.isArray(fileUrls) && fileUrls.length
    ? fileUrls.filter(Boolean)
    : (fileUrl ? [fileUrl] : []);

  // Adjacent same-TPO peers: stack each file's pages in one scroll pane.
  if (urls.length > 1) {
    return (
      <div
        className={
          fill
            ? 'absolute inset-0 overflow-y-auto overscroll-contain bg-slate-100'
            : 'w-full min-h-[240px] h-[36vh] max-h-[420px] overflow-y-auto overscroll-contain bg-slate-100'
        }
      >
        {urls.map((url, i) => (
          <div
            key={`${url}-${i}`}
            className="relative border-b border-slate-200 last:border-b-0 min-h-[220px]"
          >
            <p className="sticky top-0 z-[1] px-2 py-1 text-[11px] font-medium text-slate-600 bg-slate-200/90 backdrop-blur-sm">
              Fișier {i + 1} / {urls.length}
            </p>
            <div className="relative min-h-[200px]">
              <AvizFilePreview fileUrl={url} fill={false} zoom={zoom} uprightPreview={uprightPreview} />
            </div>
          </div>
        ))}
      </div>
    );
  }

  const singleUrl = urls[0] || '';
  return (
    <AvizFilePreviewSingle
      fileUrl={singleUrl}
      fill={fill}
      zoom={zoom}
      uprightPreview={uprightPreview}
      overlay={overlay}
    />
  );
}

function AvizFilePreviewSingle({ fileUrl, fill = false, zoom = 1, uprightPreview = true, overlay = null }) {
  const [src, setSrc] = useState('');
  const [pdfBlob, setPdfBlob] = useState(null);
  const [error, setError] = useState('');
  const [natural, setNatural] = useState(null);
  /** Last fileUrl we already painted — keep the same blob/object URL across soft remounts. */
  const loadedUrlRef = useRef('');
  const kind = previewKind(fileUrl);
  const frame = fill ? PREVIEW_FRAME_FILL : PREVIEW_FRAME_FIXED;
  const wantsOverlay = Boolean(overlay) && kind === 'image';

  useEffect(() => {
    let objectUrl = '';
    let cancelled = false;
    // Keep the previous preview visible until the new blob is ready — blanking src on
    // every parent re-render felt like a full refresh while typing in Editează.
    setError('');
    setNatural(null);

    if (!fileUrl) {
      loadedUrlRef.current = '';
      setSrc('');
      setPdfBlob(null);
      setError('Nu există fișier atașat acestui aviz.');
      return undefined;
    }

    // Manual cab entry - no bytes on disk.
    if (String(fileUrl).startsWith('manual://')) {
      loadedUrlRef.current = '';
      setSrc('');
      setPdfBlob(null);
      setError('Aviz completat manual de șofer - fără fișier atașat.');
      return undefined;
    }

    const tokenUrl = withAccessToken(fileUrl);

    (async () => {
      try {
        const blob = await fetchUploadBlob(fileUrl);
        if (cancelled) return;
        const choice = resolvePreviewSource({
          kind,
          fileUrl,
          tokenUrl,
          hasVerifiedFile: Boolean(blob),
        });
        if (choice.mode === 'token') {
          loadedUrlRef.current = fileUrl;
          setPdfBlob(null);
          setSrc(choice.url);
          return;
        }
        if (choice.mode === 'blob' && blob) {
          if (kind === 'pdf') {
            setSrc('');
            // Same fileUrl → keep the previous Blob instance so PdfCanvasViewer does not redraw.
            setPdfBlob((prev) => {
              if (loadedUrlRef.current === fileUrl && prev) return prev;
              loadedUrlRef.current = fileUrl;
              return blob;
            });
            return;
          }
          const displayBlob = uprightPreview
            ? await blobForUprightPreview(blob)
            : blob;
          if (cancelled) return;
          objectUrl = URL.createObjectURL(displayBlob);
          loadedUrlRef.current = fileUrl;
          setPdfBlob(null);
          setSrc(objectUrl);
          return;
        }
        loadedUrlRef.current = '';
        setSrc('');
        setPdfBlob(null);
        setError('Nu am putut încărca documentul. Reautentifică-te și încearcă din nou.');
      } catch {
        if (cancelled) return;
        const choice = resolvePreviewSource({
          kind,
          fileUrl,
          tokenUrl,
          hasVerifiedFile: false,
        });
        if (choice.mode === 'token') {
          loadedUrlRef.current = fileUrl;
          setPdfBlob(null);
          setSrc(choice.url);
          return;
        }
        loadedUrlRef.current = '';
        setSrc('');
        setPdfBlob(null);
        setError('Nu am putut încărca documentul. Reautentifică-te și încearcă din nou.');
      }
    })();

    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [fileUrl, kind, uprightPreview]);

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

  if (!src && !pdfBlob) {
    return (
      <p className={`text-xs text-slate-500 p-4 ${fill ? 'absolute inset-0 flex items-center' : ''}`}>
        Se încarcă preview…
      </p>
    );
  }

  const zoomFactor = Number.isFinite(Number(zoom)) && Number(zoom) > 0 ? Number(zoom) : 1;

  if (kind === 'pdf' && pdfBlob) {
    return (
      <PdfCanvasViewer
        blob={pdfBlob}
        fill={fill}
        zoom={zoomFactor}
        onError={(message) => setError(message)}
      />
    );
  }
  if (kind === 'image' || wantsOverlay) {
    // Fit-width × zoom (same as PDF). Scroll tall phone screenshots instead of shrinking
    // them with object-contain (#91). Width = zoom%, never CSS scale + inverse width —
    // that made 75% look like a heavy zoom-in on screenshots.
    const scrollPane = fill
      || zoomFactor !== 1
      || wantsOverlay;
    if (scrollPane) {
      return (
        <div
          className={
            fill
              ? 'absolute inset-0 overflow-auto overscroll-contain bg-slate-100'
              : 'relative w-full min-h-[240px] h-[36vh] max-h-[420px] overflow-auto overscroll-contain bg-slate-100'
          }
        >
          <div className="relative bg-white" style={imagePreviewZoomStyle(zoomFactor)}>
            <img
              alt="Aviz"
              className="block w-full h-auto"
              src={src}
              onError={() => setError('Nu am putut afișa imaginea.')}
              onLoad={wantsOverlay ? (e) => setNatural({
                naturalWidth: e.currentTarget.naturalWidth,
                naturalHeight: e.currentTarget.naturalHeight,
              }) : undefined}
            />
            {wantsOverlay && natural ? (
              <div className="absolute inset-0 pointer-events-none">
                {overlay(natural)}
              </div>
            ) : null}
          </div>
        </div>
      );
    }
    return (
      <img
        alt="Aviz"
        className={frame}
        src={src}
        onError={() => setError('Nu am putut afișa imaginea.')}
      />
    );
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
