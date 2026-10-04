import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Camera, ClipboardList, CloudOff, FileText, Loader2, Upload } from 'lucide-react';
import { api } from '@/api/client';
import { notifyError, notifySuccess } from '@/lib/notify';
import { findBlurriest } from '@/lib/imageQuality';
import { prepareImagesForUpload } from '@/lib/imagePreprocess';
import { throttleState } from '@/lib/uploadThrottle';
import { isOfflineError, useOnline, useOutbox } from '@/lib/useOffline';
import { offlineStore } from '@/lib/offlineStore';
import { pendingEntries } from '@/lib/offlineQueue';
import DriverAvizReviewForm, { DriverWritingTips } from '@/components/driver/DriverAvizReviewForm';
import {
  driverPrimaryBtn,
  driverSecondaryBtn,
  driverStackGap,
} from '@/lib/driverUi';

/** Companion uploads are always avize; type/trip pickers were noise on this screen. */
const DOCUMENT_TYPE = 'aviz';

const STATUS_LABEL = {
  uploaded: 'Se procesează…',
  extracted: 'OCR gata',
  needs_review: 'De revizuit',
  confirmed: 'Confirmat',
  unrecognised: 'Nerecunoscut',
  failed: 'Eșuat',
};

const REVIEW_PROMPTED_KEY = 'tx.driver.reviewPrompted';

function loadReviewPrompted() {
  try {
    const raw = sessionStorage.getItem(REVIEW_PROMPTED_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return new Set(Array.isArray(parsed) ? parsed : []);
  } catch {
    return new Set();
  }
}

function rememberReviewPrompted(id) {
  try {
    const next = loadReviewPrompted();
    next.add(id);
    sessionStorage.setItem(REVIEW_PROMPTED_KEY, JSON.stringify([...next].slice(-80)));
  } catch {
    /* private mode / quota - in-memory set still covers this session page life */
  }
}

/** Driver list: after OCR, incomplete logistics must be filled by the driver. */
function driverStatusDetail(doc, online = true) {
  if (doc.status === 'uploaded' && !online) {
    return 'Procesare întreruptă · reluăm la reconectare';
  }
  if (doc.status === 'uploaded') return STATUS_LABEL.uploaded;
  if (doc.status === 'confirmed' || doc.logistics_complete) {
    return doc.numar_tpo
      ? `Confirmat · ${doc.numar_tpo}`
      : 'Confirmat';
  }
  if (doc.extraction_source === 'none' && (doc.status === 'extracted' || doc.needs_review)) {
    return 'Eșuat OCR · completează câmpurile sau biroul Re-extrage';
  }
  if (Array.isArray(doc.missing_fields) && doc.missing_fields.length) {
    return `Lipsesc câmpuri · ${doc.missing_fields.map((m) => m.label).join(', ')}`;
  }
  const base = STATUS_LABEL[doc.status] || doc.status || '-';
  const tpo = String(doc.numar_tpo || '').trim();
  if (tpo) {
    return doc.needs_review ? `${base} · ${tpo} · de revizuit` : `${base} · ${tpo}`;
  }
  if (doc.status === 'extracted' || doc.status === 'needs_review') {
    return 'OCR gata · verifică și completează câmpurile';
  }
  if (doc.needs_review) return `${base} · de revizuit`;
  return base;
}

/** Mirrors the server's multer limit, so the driver hears about it before the upload starts. */
const MAX_UPLOAD_MB = 15;
const MAX_UPLOAD_BYTES = MAX_UPLOAD_MB * 1024 * 1024;

function browserOffline() {
  return typeof navigator !== 'undefined' && navigator.onLine === false;
}

/**
 * Driver home: photo of printed aviz (OCR → fill gaps) or completează aviz manual.
 */
export default function DriverUploadDocuments({ user }) {
  const userId = user?.id;
  const [docs, setDocs] = useState([]);
  const [queuedUploads, setQueuedUploads] = useState([]);
  const [online, setOnline] = useOnline();
  // The route has always returned this; the app used to ignore it and let the driver find the
  // limit by hitting it.
  const [maxFiles, setMaxFiles] = useState(8);
  const [blurWarning, setBlurWarning] = useState(null);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [reviewDocId, setReviewDocId] = useState(null);
  const [manualOpen, setManualOpen] = useState(false);
  const sendTimes = useRef([]);
  const fileRef = useRef(null);
  const cameraRef = useRef(null);
  const prevOutboxPending = useRef(0);
  const autoOpenedReview = useRef(loadReviewPrompted());
  const prevStatusById = useRef(new Map());

  /** Replays one queued upload once coverage is back. */
  const sendQueued = useCallback(async (entry) => {
    if (entry.kind !== 'driver_document_upload') {
      throw new Error(`Acțiune necunoscută: ${entry.kind}`);
    }
    const { files: stored = [] } = entry.payload ?? {};
    const files = stored.map((f) => {
      const blob = f.blob instanceof Blob ? f.blob : f;
      return new File([blob], f.name, { type: f.type || blob.type || 'application/octet-stream' });
    });
    return api.driverDocuments.upload({
      files,
      document_type: DOCUMENT_TYPE,
    });
  }, []);

  const outbox = useOutbox(userId, sendQueued);

  const refreshQueued = useCallback(async () => {
    if (!userId) return;
    const waiting = await pendingEntries(offlineStore, userId);
    setQueuedUploads(waiting.filter((e) => e.kind === 'driver_document_upload'));
  }, [userId]);

  const clearFileInputs = () => {
    if (fileRef.current) fileRef.current.value = '';
    if (cameraRef.current) cameraRef.current.value = '';
  };

  const queueFiles = useCallback(async (files) => {
    if (!userId) {
      notifyError('Încărcare eșuată', 'Nu am putut salva documentele pe telefon.');
      return false;
    }
    await outbox.queue({
      kind: 'driver_document_upload',
      label: files.length === 1 ? files[0].name : `${files.length} documente`,
      run: {
        document_type: DOCUMENT_TYPE,
        files: files.map((f) => ({ name: f.name, type: f.type, blob: f })),
      },
    });
    await refreshQueued();
    notifySuccess(
      'Salvat pe telefon',
      `${files.length} fișier(e), se trimite automat când prinzi semnal`
    );
    return true;
  }, [userId, outbox, refreshQueued]);

  const syncDocs = useCallback(async () => {
    const mine = await api.driverDocuments.listMine(30);
    setDocs(mine.documents || []);
    if (mine.max_files) setMaxFiles(mine.max_files);
    return mine;
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const syncResult = await syncDocs()
        .then((value) => ({ ok: true, value }))
        .catch((err) => ({ ok: false, err }));

      if (syncResult.ok) setOnline(true);
      else if (isOfflineError(syncResult.err)) setOnline(false);
      else throw syncResult.err;
    } catch (err) {
      if (isOfflineError(err)) setOnline(false);
      else notifyError('Nu am putut încărca documentele', err);
    } finally {
      setLoading(false);
      await refreshQueued();
    }
  }, [syncDocs, setOnline, refreshQueued]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { refreshQueued(); }, [refreshQueued]);

  /**
   * OCR runs after the upload responds, so a row sent a moment ago still says "Se procesează…".
   * Refresh only the document list, only while something is still pending, and only while the
   * tab is visible, a phone in a cab should not poll from a pocket.
   */
  const pending = docs.some((d) => d.status === 'uploaded');
  const hasQueuedUploads = queuedUploads.length > 0;
  const refreshDocs = useCallback(async () => {
    if (document.hidden) return;
    try {
      await syncDocs();
      setOnline(true);
    } catch (err) {
      if (isOfflineError(err)) setOnline(false);
    }
  }, [syncDocs, setOnline]);

  useEffect(() => {
    if (outbox.counts.pending < prevOutboxPending.current) {
      refreshDocs();
      refreshQueued();
    }
    prevOutboxPending.current = outbox.counts.pending;
  }, [outbox.counts.pending, refreshDocs, refreshQueued]);

  /** When coverage drops mid-OCR, stop the spinner immediately, don't wait for the next poll. */
  useEffect(() => {
    const onOffline = () => setOnline(false);
    window.addEventListener('offline', onOffline);
    return () => window.removeEventListener('offline', onOffline);
  }, [setOnline]);

  useEffect(() => {
    if (!pending) return undefined;
    const id = setInterval(refreshDocs, 8000);
    document.addEventListener('visibilitychange', refreshDocs);
    return () => {
      clearInterval(id);
      document.removeEventListener('visibilitychange', refreshDocs);
    };
  }, [pending, refreshDocs]);

  /**
   * When OCR just finished with gaps, open the form once. Do not toast on every reload -
   * incomplete „Eșuat OCR” rows stay incomplete until the driver taps „Completează câmpurile”.
   */
  useEffect(() => {
    const prev = prevStatusById.current;
    for (const doc of docs) {
      const was = prev.get(doc.id);
      prev.set(doc.id, doc.status);

      if (doc.status === 'uploaded' || doc.status === 'confirmed') continue;
      if (doc.logistics_complete) continue;
      if (!Array.isArray(doc.missing_fields) || !doc.missing_fields.length) continue;
      if (autoOpenedReview.current.has(doc.id)) continue;

      // Only auto-prompt right after OCR leaves „Se procesează…”, not for every list refresh
      // or page reload of already-failed rows.
      if (was !== 'uploaded') continue;

      autoOpenedReview.current.add(doc.id);
      rememberReviewPrompted(doc.id);
      setReviewDocId(doc.id);
      notifyError(
        'Completează câmpurile lipsă',
        `OCR nu a găsit tot: ${doc.missing_fields.map((m) => m.label).join(', ')}`,
      );
      break;
    }
  }, [docs]);

  const reviewDoc = docs.find((d) => d.id === reviewDocId) || null;

  /** When coverage returns, pull the list right away, don't wait for the next poll tick. */
  const wasOnline = useRef(online);
  useEffect(() => {
    const cameBack = online && !wasOnline.current;
    wasOnline.current = online;
    if (cameBack) refreshDocs();
  }, [online, refreshDocs]);

  /**
   * Coming back to the tab after a long pause: re-probe the API so a stale `online === false`
   * does not send the first photo only to the outbox.
   */
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === 'visible') refreshDocs();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [refreshDocs]);

  const uploadFiles = async (fileList) => {
    const picked = [...(fileList || [])];
    if (!picked.length) return;

    setUploading(true);
    try {
      // Say what the limit is before the upload, not after: on a phone the round trip costs the
      // driver their data and a wait, and the answer used to come back as `Unexpected field`.
      if (picked.length > maxFiles) {
        notifyError(
          'Prea multe fișiere',
          `Poți trimite maximum ${maxFiles} odată. Ai ales ${picked.length}. Trimite-le în două rânduri.`
        );
        return;
      }
      // Rotate, downscale and re-encode in the browser first: a 6 MB frame becomes ~1 MB
      // before the size check, so a phone camera at full resolution is not refused for it.
      const files = await prepareImagesForUpload(picked);
      const tooBig = files.find((f) => f.size > MAX_UPLOAD_BYTES);
      if (tooBig) {
        notifyError(
          'Fișier prea mare',
          `„${tooBig.name}" are ${(tooBig.size / 1024 / 1024).toFixed(1)} MB. Limita este de ${MAX_UPLOAD_MB} MB.`
        );
        return;
      }

      // A photo the office cannot read is a trip back to the truck. Say so now, but never block:
      // the check is a heuristic and a sent document beats a refused one. Timed out after wake so
      // the first photo of the day is not stuck behind a cold image decoder.
      const worst = await findBlurriest(files).catch(() => null);
      if (worst) {
        setBlurWarning({ files, name: worst.file.name });
        return;
      }

      await sendFiles(files);
    } finally {
      // Blur path returns early without sendFiles' finally - clear the spinner either way.
      setUploading(false);
    }
  };

  /**
   * After a long pause the app can still think it is offline (stale flag) while the radio is
   * fine - the first photo then went only to the outbox and never appeared under „Trimise recent”.
   * Always try the network unless the browser itself reports offline; queue only if the send fails.
   */
  const sendFiles = async (files) => {
    const brake = throttleState(sendTimes.current);
    sendTimes.current = brake.recent;
    if (!brake.allowed) {
      notifyError(
        'Prea multe trimiteri',
        `Ai trimis multe documente într-un minut. Mai așteaptă ${brake.retryInSeconds} secunde.`
      );
      return;
    }
    sendTimes.current = [...brake.recent, Date.now()];

    setBlurWarning(null);

    if (browserOffline()) {
      await queueFiles(files);
      clearFileInputs();
      return;
    }

    setUploading(true);
    const controller = new AbortController();
    const onOffline = () => {
      controller.abort();
      setOnline(false);
    };
    window.addEventListener('offline', onOffline);
    try {
      const result = await api.driverDocuments.upload({
        files,
        document_type: DOCUMENT_TYPE,
        signal: controller.signal,
      });
      const n = result.documents?.length || files.length;
      const splitN = Number(result.split_pages) || 0;
      notifySuccess(
        'Documente trimise',
        splitN > 1
          ? `PDF despărțit în ${splitN} avize · OCR rulează, apoi completezi câmpurile lipsă`
          : `${n} fișier(e) · OCR rulează, apoi completezi câmpurile lipsă`,
      );
      setDocs((prev) => [...(result.documents || []), ...prev].slice(0, 40));
      setOnline(true);
    } catch (err) {
      if (err?.name === 'AbortError' || isOfflineError(err)) {
        setOnline(false);
        await queueFiles(files);
      } else {
        notifyError('Încărcare eșuată', err);
      }
    } finally {
      window.removeEventListener('offline', onOffline);
      setUploading(false);
      clearFileInputs();
    }
  };

  if (loading) {
    return (
      <div className="flex justify-center py-16">
        <Loader2 className="w-7 h-7 text-slate-300 animate-spin" />
      </div>
    );
  }

  return (
    <div className={driverStackGap}>
      <p className="text-base text-slate-600 leading-relaxed">
        Pozează avizul tipărit - OCR citește ce poate. Dacă lipsesc câmpuri, le completezi manual.
        Sau scrii totul cu „Aviz manual”.
      </p>

      <DriverWritingTips />

      {!online ? (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-4 flex items-start gap-3">
          <CloudOff className="w-6 h-6 shrink-0 mt-0.5 text-amber-600" />
          <div className="min-w-0">
            <p className="text-base font-semibold text-amber-900">Fără conexiune</p>
            <p className="text-base text-amber-900/90 mt-1 leading-relaxed">
              {pending || hasQueuedUploads
                ? 'Documentele salvate pe telefon se trimit automat când revine internetul.'
                : 'Trimiterea merge doar cu semnal. Poți pregăti fișierele până atunci.'}
            </p>
          </div>
        </div>
      ) : null}

      {blurWarning && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 space-y-4">
          <p className="text-base font-semibold text-amber-900">Poza pare mișcată</p>
          <p className="text-base text-amber-900/90 leading-relaxed break-words">
            „{blurWarning.name}" iese neclară. Sprijină telefonul și mai fă una, cu avizul drept și bine luminat.
          </p>
          <div className="flex flex-col gap-3">
            <button
              type="button"
              onClick={() => { setBlurWarning(null); cameraRef.current?.click(); }}
              className={driverPrimaryBtn}
            >
              Refă poza
            </button>
            <button
              type="button"
              onClick={() => sendFiles(blurWarning.files)}
              className={driverSecondaryBtn}
            >
              Trimite oricum
            </button>
          </div>
        </div>
      )}

      <div className="bg-white rounded-xl border border-slate-200/80 shadow-sm p-4 sm:p-5 space-y-4">
        <input
          ref={fileRef}
          type="file"
          accept="image/*,application/pdf"
          multiple
          className="hidden"
          onChange={(e) => uploadFiles(e.target.files)}
        />
        <input
          ref={cameraRef}
          type="file"
          accept="image/*"
          capture="environment"
          className="hidden"
          onChange={(e) => uploadFiles(e.target.files)}
        />

        <div className="flex flex-col gap-3">
          <button
            type="button"
            disabled={uploading || manualOpen}
            onClick={() => {
              setManualOpen(false);
              cameraRef.current?.click();
            }}
            className={driverPrimaryBtn}
          >
            {uploading ? <Loader2 className="w-6 h-6 animate-spin" /> : <Camera className="w-6 h-6" />}
            Fă o poză
          </button>
          <button
            type="button"
            disabled={uploading || manualOpen}
            onClick={() => {
              setReviewDocId(null);
              setManualOpen(true);
            }}
            className={driverSecondaryBtn}
          >
            <ClipboardList className="w-5 h-5" />
            Completează aviz manual
          </button>
        </div>
        <button
          type="button"
          disabled={uploading || manualOpen}
          onClick={() => fileRef.current?.click()}
          className="inline-flex w-full min-h-12 items-center justify-center gap-2 rounded-lg px-3 text-base font-medium text-slate-500 hover:bg-slate-50 disabled:opacity-50"
        >
          <Upload className="w-4 h-4" />
          Sau din galerie / fișier PDF
        </button>
      </div>

      {manualOpen ? (
        <DriverAvizReviewForm
          mode="create"
          documentType={DOCUMENT_TYPE}
          onCancel={() => setManualOpen(false)}
          onSaved={(created) => {
            setDocs((prev) => [created, ...prev].slice(0, 40));
            setManualOpen(false);
          }}
        />
      ) : null}

      {reviewDoc ? (
        <DriverAvizReviewForm
          mode="review"
          doc={reviewDoc}
          onCancel={() => setReviewDocId(null)}
          onSaved={(updated) => {
            setDocs((prev) => prev.map((d) => (d.id === updated.id ? { ...d, ...updated } : d)));
            setReviewDocId(null);
          }}
        />
      ) : null}

      <div className="bg-white rounded-xl border border-slate-200/80 shadow-sm overflow-hidden">
        <div className="px-4 sm:px-5 py-4 border-b border-slate-100">
          <h3 className="text-lg font-semibold text-[#0A2B4E]">Trimise recent</h3>
        </div>
        {hasQueuedUploads || docs.length > 0 ? (
          <ul className="divide-y divide-slate-100">
            {queuedUploads.map((entry) => (
              <li key={entry.id} className="px-4 sm:px-5 py-4 flex items-start gap-3 min-w-0">
                <CloudOff className="w-5 h-5 text-amber-500 mt-0.5 shrink-0" />
                <div className="min-w-0 flex-1">
                  <p className="text-base font-medium text-slate-800 break-words">
                    {entry.label || 'Document'}
                  </p>
                  <p className="text-base text-slate-500 mt-1 break-words leading-snug">
                    <span className="inline-flex items-center gap-1.5 text-amber-800 font-medium">
                      {outbox.flushing ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                      {outbox.flushing ? 'Se trimite…' : 'Netrimis · așteaptă semnal'}
                    </span>
                    {entry.queued_at
                      ? ` · ${new Date(entry.queued_at).toLocaleString('ro-RO')}`
                      : ''}
                  </p>
                </div>
              </li>
            ))}
            {docs.map((doc) => (
              <li key={doc.id} className="px-4 sm:px-5 py-4 flex items-start gap-3 min-w-0">
                <FileText className="w-5 h-5 text-slate-400 mt-0.5 shrink-0" />
                <div className="min-w-0 flex-1">
                  <p className="text-base font-medium text-slate-800 break-words">
                    {doc.original_filename || 'Document'}
                  </p>
                  <p className={`text-base mt-1 break-words leading-snug ${
                    doc.status === 'uploaded'
                      ? (online ? 'text-sky-800' : 'text-amber-800')
                      : doc.logistics_complete || doc.status === 'confirmed'
                        ? 'text-emerald-800'
                        : 'text-amber-900'
                  }`}>
                    <span className="inline-flex items-center gap-1.5 font-medium">
                      {doc.status === 'uploaded' ? (
                        online
                          ? <Loader2 className="w-4 h-4 animate-spin" />
                          : <CloudOff className="w-4 h-4" />
                      ) : null}
                      {driverStatusDetail(doc, online)}
                    </span>
                    {doc.created_at
                      ? <span className="text-slate-500 font-normal"> · {new Date(doc.created_at).toLocaleString('ro-RO')}</span>
                      : null}
                  </p>
                  {doc.status !== 'uploaded' && doc.status !== 'confirmed' && !doc.logistics_complete ? (
                    <button
                      type="button"
                      onClick={() => setReviewDocId(doc.id)}
                      className={`${driverSecondaryBtn} mt-3`}
                    >
                      Completează câmpurile
                    </button>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <p className="px-4 py-10 text-center text-base text-slate-500">
            Niciun document trimis încă.
          </p>
        )}
      </div>
    </div>
  );
}
