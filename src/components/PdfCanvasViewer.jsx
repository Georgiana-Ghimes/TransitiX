import React, { useEffect, useRef, useState } from 'react';
import pdfWorkerUrl from 'pdfjs-dist/legacy/build/pdf.worker.min.mjs?url';
import { pdfPageScale } from '@/lib/pdfPreviewScale';

let workerReady = false;

async function loadPdfjs() {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  if (!workerReady) {
    pdfjs.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;
    workerReady = true;
  }
  return pdfjs;
}

function waitForWidth(el, signal) {
  const read = () => el?.clientWidth || 0;
  if (read() > 0) return Promise.resolve(read());
  return new Promise((resolve) => {
    const finish = (width) => {
      observer.disconnect();
      resolve(width);
    };
    const observer = new ResizeObserver(() => {
      const width = read();
      if (width > 0) finish(width);
    });
    observer.observe(el);
    signal.addEventListener('abort', () => finish(0), { once: true });
  });
}

/**
 * Draws a PDF onto canvases. The browser's own PDF viewer (iframe / embed) is not involved:
 * that viewer is blank on a lot of phones, which is the failure this replaces.
 *
 * @param {{ blob: Blob, fill?: boolean, onError?: (message: string) => void }} props
 */
export default function PdfCanvasViewer({ blob, fill = false, onError }) {
  const hostRef = useRef(null);
  const hasPagesRef = useRef(false);
  const [status, setStatus] = useState('loading');
  const onErrorRef = useRef(onError);
  onErrorRef.current = onError;

  useEffect(() => {
    const host = hostRef.current;
    if (!blob || !host) return undefined;
    let cancelled = false;
    const abort = new AbortController();
    /** @type {Array<{ cancel?: () => void }>} */
    const tasks = [];
    /** @type {{ destroy?: () => void } | null} */
    let loadingTask = null;
    /** @type {{ destroy?: () => void } | null} */
    let pdfDoc = null;

    (async () => {
      // Keep the previous paint on screen while a new blob loads — only spin on first open.
      if (!hasPagesRef.current) setStatus('loading');
      try {
        const pdfjs = await loadPdfjs();
        const data = new Uint8Array(await blob.arrayBuffer());
        if (cancelled) return;
        loadingTask = pdfjs.getDocument({
          data,
          disableRange: true,
          disableStream: true,
          isEvalSupported: false,
        });
        pdfDoc = await loadingTask.promise;
        if (cancelled) {
          pdfDoc.destroy();
          return;
        }
        const paneWidth = await waitForWidth(host, abort.signal);
        if (cancelled || !hostRef.current) {
          pdfDoc.destroy();
          return;
        }
        // Render each page fully before attaching it. Page 1 replaces the previous paint
        // in one shot; later pages append — no empty flash between blob changes.
        for (let i = 1; i <= pdfDoc.numPages; i += 1) {
          if (cancelled) return;
          const page = await pdfDoc.getPage(i);
          const base = page.getViewport({ scale: 1 });
          const scale = pdfPageScale(paneWidth, base.width);
          const viewport = page.getViewport({ scale });
          const dpr = Math.min(window.devicePixelRatio || 1, 2);
          const canvas = document.createElement('canvas');
          canvas.width = Math.floor(viewport.width * dpr);
          canvas.height = Math.floor(viewport.height * dpr);
          canvas.style.width = '100%';
          canvas.style.height = 'auto';
          canvas.style.maxWidth = '100%';
          canvas.className = 'block bg-white';
          const frame = document.createElement('div');
          frame.className = 'mb-2 last:mb-0 bg-white shadow-sm';
          frame.appendChild(canvas);
          const task = page.render({
            canvasContext: canvas.getContext('2d'),
            viewport,
            ...(dpr === 1 ? {} : { transform: [dpr, 0, 0, dpr, 0, 0] }),
          });
          tasks.push(task);
          await task.promise;
          if (cancelled || !hostRef.current) return;
          if (i === 1) {
            host.replaceChildren(frame);
            hasPagesRef.current = true;
            setStatus('ready');
          } else {
            host.appendChild(frame);
          }
        }
        if (!cancelled) {
          hasPagesRef.current = true;
          setStatus('ready');
        }
      } catch (err) {
        if (cancelled || err?.name === 'RenderingCancelledException') return;
        const message = 'Nu am putut afișa PDF-ul în pagină.';
        setStatus('error');
        onErrorRef.current?.(message);
      }
    })();

    return () => {
      cancelled = true;
      abort.abort();
      for (const task of tasks) {
        try { task.cancel(); } catch { /* already finished */ }
      }
      try { loadingTask?.destroy(); } catch { /* already settled */ }
      try { pdfDoc?.destroy(); } catch { /* already destroyed */ }
    };
  }, [blob]);

  const frame = fill
    ? 'absolute inset-0 overflow-auto bg-slate-100 p-2'
    : 'w-full min-h-[240px] h-[36vh] max-h-[420px] overflow-auto bg-slate-100 p-2';

  return (
    <div className={frame}>
      {status === 'loading' && !hasPagesRef.current ? (
        <p className="text-xs text-slate-500 p-2">Se desenează documentul…</p>
      ) : null}
      <div ref={hostRef} />
    </div>
  );
}
