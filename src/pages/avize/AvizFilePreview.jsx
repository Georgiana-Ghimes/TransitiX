import React, { useEffect, useState } from 'react';
import { previewKind } from '@/lib/avizOps';
import { fetchUploadBlob } from '@/lib/uploadUrl';

const SOURCE_LABEL = {
  'pdf-text': 'Text PDF',
  vision: 'Vision',
  stub: 'Stub',
};

export function SourceBadge({ source }) {
  const key = source || 'stub';
  const tone = key === 'pdf-text'
    ? 'bg-sky-50 text-sky-800'
    : key === 'vision'
      ? 'bg-violet-50 text-violet-800'
      : 'bg-amber-50 text-amber-800';
  return (
    <span className={`inline-block text-[11px] px-2 py-0.5 rounded-full ${tone}`}>
      {SOURCE_LABEL[key] || key}
    </span>
  );
}

export default function AvizFilePreview({ fileUrl }) {
  const [src, setSrc] = useState('');
  const kind = previewKind(fileUrl);

  useEffect(() => {
    let objectUrl = '';
    let cancelled = false;
    (async () => {
      const blob = await fetchUploadBlob(fileUrl);
      if (cancelled || !blob) return;
      objectUrl = URL.createObjectURL(blob);
      setSrc(objectUrl);
    })();
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [fileUrl]);

  if (!src) {
    return <p className="text-xs text-slate-500 p-4">Se încarcă preview…</p>;
  }
  if (kind === 'pdf') {
    return <iframe title="Previzualizare aviz" className="w-full h-[320px]" src={src} />;
  }
  if (kind === 'image') {
    return <img alt="Aviz" className="w-full max-h-[320px] object-contain" src={src} />;
  }
  return <p className="text-xs text-slate-500 p-4">Nu există preview pentru acest fișier.</p>;
}
