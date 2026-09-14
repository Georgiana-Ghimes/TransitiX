import React, { useEffect, useState } from 'react';
import { previewKind } from '@/lib/avizOps';
import { fetchUploadBlob, withAccessToken } from '@/lib/uploadUrl';

const SOURCE_LABEL = {
  'pdf-text': 'Text PDF',
  vision: 'Vision',
  paddle: 'Paddle',
  stub: 'Stub',
  // `none` is what the extractor stores when a read failed. Without a label the badge printed
  // the raw column value at the operator.
  none: 'Fără OCR',
};

const SOURCE_TONE = {
  'pdf-text': 'bg-sky-50 text-sky-800',
  vision: 'bg-violet-50 text-violet-800',
  paddle: 'bg-indigo-50 text-indigo-800',
  none: 'bg-rose-50 text-rose-800',
  stub: 'bg-amber-50 text-amber-800',
};

export function SourceBadge({ source }) {
  const key = source || 'stub';
  const tone = SOURCE_TONE[key] || SOURCE_TONE.stub;
  return (
    <span className={`inline-block text-[11px] px-2 py-0.5 rounded-full ${tone}`}>
      {SOURCE_LABEL[key] || key}
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
export function NeedsReviewBadge({ needsReview }) {
  if (!needsReview) return null;
  return (
    <span className="inline-block text-[11px] px-2 py-0.5 rounded-full bg-amber-50 text-amber-800">
      De revizuit
    </span>
  );
}

const PREVIEW_FRAME_FIXED =
  'w-full border-0 bg-white min-h-[240px] h-[36vh] max-h-[420px] object-contain';
const PREVIEW_FRAME_FILL =
  'absolute inset-0 w-full h-full border-0 bg-slate-100 object-contain';

export default function AvizFilePreview({ fileUrl, fill = false }) {
  const [src, setSrc] = useState('');
  const [error, setError] = useState('');
  const kind = previewKind(fileUrl);
  const frame = fill ? PREVIEW_FRAME_FILL : PREVIEW_FRAME_FIXED;

  useEffect(() => {
    let objectUrl = '';
    let cancelled = false;
    setSrc('');
    setError('');

    if (!fileUrl) {
      setError('Nu există fișier atașat acestui aviz.');
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
        // Bearer fetch failed (proxy/session) — query-token URL still works for <img>/<iframe>.
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

  const openUrl = src || withAccessToken(fileUrl);

  if (error) {
    return (
      <div className={`${fill ? 'absolute inset-0 flex flex-col justify-center' : ''} p-4 space-y-2`}>
        <p className="text-xs text-amber-800">{error}</p>
        {openUrl ? (
          <a href={openUrl} target="_blank" rel="noreferrer" className="text-xs text-sky-700 hover:underline">
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
