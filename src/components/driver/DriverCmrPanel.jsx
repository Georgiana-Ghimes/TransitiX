import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Camera, CheckCircle2, CloudOff, FileText, Loader2, Printer, RotateCw, Save, Trash2,
} from 'lucide-react';
import { api } from '@/api/client';
import { useAuth } from '@/lib/AuthContext';
import { notifyError, notifySuccess } from '@/lib/notify';
import { isOfflineError, useOutbox } from '@/lib/useOffline';
import { offlineStore } from '@/lib/offlineStore';
import {
  draftDiffers, dropDraft, queueSummary, readDraft, saveDraft as persistDraft,
} from '@/lib/offlineQueue';
import { withAccessToken } from '@/lib/uploadUrl';
import SignaturePad from '@/components/driver/SignaturePad';
import {
  DOC_TYPES,
  currentStage,
  editableBoxes as editableBoxesFor,
  isFullySigned,
  isStageLocked,
  missingLabels,
  pendingSignatures,
  prefillBoxes as prefillBoxesFor,
  priorStageBoxes as priorStageBoxesFor,
  signatureBoxes as signatureBoxesFor,
  stageCaption,
} from '@/lib/cmrUi';

function SignedOrPad({ label, value, disabled, padRef }) {
  if (value && String(value).startsWith('/')) {
    return (
      <div className="space-y-1">
        <p className="text-xs font-medium text-slate-600">{label}</p>
        <img
          src={withAccessToken(value)}
          alt={label}
          className="w-full max-h-28 object-contain rounded-lg border border-emerald-200 bg-white"
        />
        <p className="text-[11px] text-emerald-700">Semnat</p>
      </div>
    );
  }
  return (
    <div className="space-y-1">
      <p className="text-xs font-medium text-slate-600">{label}</p>
      <SignaturePad ref={padRef} disabled={disabled} height={112} />
    </div>
  );
}

/**
 * Digital CMR (+ optional road photos → Faza 3 document batches).
 * Used in the driver app and on office trip detail.
 */
export default function DriverCmrPanel({ trip, showBatchUpload = true }) {
  const tripId = trip?.id;
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [signing, setSigning] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [printing, setPrinting] = useState(false);
  const [model, setModel] = useState(null);
  const [form, setForm] = useState({});
  const [roadDocs, setRoadDocs] = useState([]);
  const [docType, setDocType] = useState('aviz');
  const fileRef = useRef(null);
  const sigRefs = useRef({});
  const { user } = useAuth();
  const userId = user?.id;
  const [restorable, setRestorable] = useState(null);

  /**
   * Replays one queued action.
   *
   * Kept beside the calls it mirrors so the two cannot drift: a payload shape changed in one
   * place and not the other would only fail once the driver was already back in coverage.
   */
  const sendQueued = useCallback(async (entry) => {
    const { tripId: id, ...rest } = entry.payload ?? {};
    if (entry.kind === 'cmr_draft') return api.cmr.save(id, rest.data);
    if (entry.kind === 'cmr_sign') return api.cmr.sign(id, rest);
    throw new Error(`Acțiune necunoscută: ${entry.kind}`);
  }, []);

  const outbox = useOutbox(userId, sendQueued);

  const stage = useMemo(() => currentStage(model), [model]);

  const load = useCallback(async () => {
    if (!tripId) return;
    setLoading(true);
    try {
      const tasks = [api.cmr.get(tripId)];
      if (showBatchUpload) {
        tasks.push(api.driverDocuments.listForTrip(tripId).catch(() => ({ documents: [] })));
      }
      const [cmr, docs] = await Promise.all(tasks);
      setModel(cmr);
      setForm(cmr.data || {});
      setRoadDocs(docs?.documents || []);
      sigRefs.current = {};

      // A draft only worth offering if it still holds something the server does not — otherwise
      // the prompt appears every time and drivers learn to dismiss it.
      const draft = await readDraft(offlineStore, userId, tripId);
      setRestorable(draftDiffers(draft, cmr.data) ? draft : null);
    } catch (err) {
      notifyError('CMR-ul nu s-a încărcat', err);
    } finally {
      setLoading(false);
    }
  }, [tripId, showBatchUpload, userId]);

  useEffect(() => { load(); }, [load]);

  const editableBoxes = useMemo(() => editableBoxesFor(model, stage), [model, stage]);
  const prefillBoxes = useMemo(() => prefillBoxesFor(model), [model]);
  const priorStageBoxes = useMemo(() => priorStageBoxesFor(model, stage), [model, stage]);
  const signatureBoxes = useMemo(() => signatureBoxesFor(model, stage), [model, stage]);

  const stageLocked = isStageLocked(model, stage);
  const fullySigned = isFullySigned(model);

  const setField = (id, value) => {
    setForm((f) => {
      const next = { ...f, [id]: value };
      // Written on every keystroke, not on save: the ramp is exactly where the app gets
      // closed, the phone dies, or the page reloads on a flaky connection.
      persistDraft(offlineStore, userId, tripId, next);
      return next;
    });
  };

  const saveDraft = async () => {
    setSaving(true);
    try {
      const next = await api.cmr.save(tripId, form);
      setModel(next);
      setForm(next.data || {});
      await dropDraft(offlineStore, userId, tripId);
      setRestorable(null);
      notifySuccess('CMR salvat', 'Ciornă — încă nesemnată');
    } catch (err) {
      if (isOfflineError(err)) {
        await outbox.queue({
          kind: 'cmr_draft',
          label: 'Ciornă CMR',
          run: { tripId, data: form },
        });
        outbox.setOnline(false);
        notifySuccess('Salvat pe telefon', 'Se trimite singur când prinzi semnal');
      } else {
        notifyError('Salvare eșuată', err);
      }
    } finally {
      setSaving(false);
    }
  };

  const signStage = async () => {
    setSigning(true);
    try {
      const signatures = pendingSignatures(model, stage, sigRefs.current);
      const next = await api.cmr.sign(tripId, { stage, data: form, signatures });
      setModel(next);
      setForm(next.data || {});
      sigRefs.current = {};
      await dropDraft(offlineStore, userId, tripId);
      setRestorable(null);
      notifySuccess(
        stage === 'incarcare' ? 'CMR semnat la încărcare' : 'CMR semnat la livrare',
        'Documentul digital e pe cursă'
      );
    } catch (err) {
      if (isOfflineError(err)) {
        // The signatures are data URLs of a few kilobytes, so the drawn ink itself is what gets
        // queued — losing a finger-drawn signature to a dead spot is the whole reason this exists.
        const signatures = pendingSignatures(model, stage, sigRefs.current);
        await outbox.queue({
          kind: 'cmr_sign',
          label: stage === 'incarcare' ? 'Semnătură încărcare' : 'Semnătură livrare',
          run: { tripId, stage, data: form, signatures },
        });
        outbox.setOnline(false);
        notifySuccess('Semnătura e pe telefon', 'Se trimite singură când prinzi semnal');
      } else {
        const missing = missingLabels(err);
        if (missing) notifyError('CMR incomplet', missing);
        else notifyError('Semnare eșuată', err);
      }
    } finally {
      setSigning(false);
    }
  };

  /**
   * Hands over the printable note.
   *
   * The writer is imported on demand: jsPDF and the rasterizer are large, and a driver on a
   * phone should not pay for them until they actually need a sheet of paper.
   */
  const printSheet = async () => {
    setPrinting(true);
    try {
      const { downloadCmrSheet } = await import('@/lib/cmrSheetPdf');
      const { missingSignatures } = await downloadCmrSheet(model);
      if (missingSignatures.length) {
        // A signature that failed to load prints as a blank line, which would read as unsigned.
        notifyError('Semnături lipsă din PDF', `${missingSignatures.length} semnătură(i) nu s-au putut încărca`);
      }
    } catch (err) {
      notifyError('PDF-ul nu s-a generat', err);
    } finally {
      setPrinting(false);
    }
  };

  const onUploadFiles = async (e) => {
    const files = [...(e.target.files || [])];
    e.target.value = '';
    if (!files.length) return;
    setUploading(true);
    try {
      const result = await api.driverDocuments.upload({
        tripId,
        files,
        document_type: docType,
      });
      setRoadDocs((prev) => [...(result.documents || []), ...prev]);
      notifySuccess(
        'Documente în lot',
        `${result.documents?.length || files.length} fișier(e) → coada biroului (OCR)`
      );
    } catch (err) {
      if (isOfflineError(err)) {
        outbox.setOnline(false);
        notifyError('Fără semnal', 'Pozele se încarcă doar cu semnal. Încearcă din nou mai târziu.');
      } else {
        notifyError('Încărcare eșuată', err);
      }
    } finally {
      setUploading(false);
    }
  };

  if (loading) {
    return (
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-8 flex justify-center">
        <Loader2 className="w-6 h-6 text-slate-300 animate-spin" />
      </div>
    );
  }

  if (model?.has_scan) {
    return (
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-5 space-y-3">
        <h3 className="text-sm font-semibold text-[#0A2B4E]">Document CMR</h3>
        <p className="text-sm text-slate-600">
          Pe cursă există deja un CMR scanat. Formularul digital e dezactivat ca să nu apară
          două variante diferite ale aceleiași note.
        </p>
        {model.document?.original_image_url && (
          <img
            src={withAccessToken(model.document.original_image_url)}
            alt="CMR scanat"
            className="w-full max-h-48 object-contain rounded border border-slate-200 bg-white"
          />
        )}
      </div>
    );
  }

  const waiting = queueSummary(outbox.counts);

  return (
    <div className="space-y-4">
      {!outbox.online || waiting ? (
        <div
          className={`rounded-xl border px-4 py-3 flex items-start gap-3 ${
            outbox.counts.parked
              ? 'border-red-200 bg-red-50'
              : 'border-amber-200 bg-amber-50'
          }`}
        >
          <CloudOff className={`w-5 h-5 shrink-0 mt-0.5 ${outbox.counts.parked ? 'text-red-600' : 'text-amber-600'}`} />
          <div className="min-w-0 flex-1">
            <p className={`text-sm font-medium ${outbox.counts.parked ? 'text-red-900' : 'text-amber-900'}`}>
              {outbox.online ? 'Ai lucru netrimis' : 'Fără semnal'}
            </p>
            <p className={`text-xs mt-0.5 ${outbox.counts.parked ? 'text-red-800' : 'text-amber-800'}`}>
              {waiting
                ? `${waiting}. Nu închide aplicația fără semnal — ce ai scris rămâne salvat pe telefon.`
                : 'Poți completa și semna în continuare; totul se trimite când prinzi semnal.'}
            </p>
            {outbox.counts.parked ? (
              <p className="text-xs text-red-800 mt-1">
                Câteva acțiuni au fost respinse de server și nu se mai retrimit singure.
                Sună dispecerul.
              </p>
            ) : null}
          </div>
          <div className="flex flex-col gap-1 shrink-0">
            {outbox.counts.pending ? (
              <button
                type="button"
                onClick={outbox.flushNow}
                disabled={outbox.flushing}
                className="text-xs px-2 py-1.5 rounded border border-amber-300 bg-white text-amber-800 disabled:opacity-40 inline-flex items-center gap-1 min-h-[36px]"
              >
                {outbox.flushing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RotateCw className="w-3.5 h-3.5" />}
                Trimite
              </button>
            ) : null}
            {outbox.counts.parked ? (
              <button
                type="button"
                onClick={outbox.dismissParked}
                className="text-xs px-2 py-1.5 rounded border border-red-300 bg-white text-red-800 inline-flex items-center gap-1 min-h-[36px]"
              >
                <Trash2 className="w-3.5 h-3.5" /> Renunță
              </button>
            ) : null}
          </div>
        </div>
      ) : null}

      {restorable ? (
        <div className="rounded-xl border border-blue-200 bg-blue-50 px-4 py-3 flex items-start gap-3">
          <FileText className="w-5 h-5 text-blue-600 shrink-0 mt-0.5" />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium text-blue-900">Ai o ciornă nesalvată pe telefon</p>
            <p className="text-xs text-blue-800 mt-0.5">
              Scrisă {new Date(restorable.saved_at).toLocaleString('ro-RO')}. Serverul are altă
              variantă.
            </p>
          </div>
          <div className="flex flex-col gap-1 shrink-0">
            <button
              type="button"
              onClick={() => { setForm((f) => ({ ...f, ...restorable.data })); setRestorable(null); }}
              className="text-xs px-2 py-1.5 rounded bg-[#1D4E89] text-white min-h-[36px]"
            >
              Recuperează
            </button>
            <button
              type="button"
              onClick={async () => { await dropDraft(offlineStore, userId, tripId); setRestorable(null); }}
              className="text-xs px-2 py-1.5 rounded border border-blue-300 bg-white text-blue-800 min-h-[36px]"
            >
              Renunță
            </button>
          </div>
        </div>
      ) : null}

      <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-5 space-y-4">
        <div className="flex items-start justify-between gap-2">
          <div>
            <h3 className="text-sm font-semibold text-[#0A2B4E]">CMR digital</h3>
            <p className="text-xs text-slate-500 mt-0.5">
              {stageCaption(model)}
            </p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {model?.completeness && (
              <span className="text-[11px] tabular-nums text-slate-400">
                {model.completeness.filled}/{model.completeness.total} câmpuri
              </span>
            )}
            <button
              type="button"
              onClick={printSheet}
              disabled={printing}
              title="Descarcă CMR-ul ca PDF, de înmânat sau de arătat la control"
              className="text-xs px-2 py-1.5 rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50 disabled:opacity-40 inline-flex items-center gap-1 min-h-[36px]"
            >
              {printing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Printer className="w-3.5 h-3.5" />}
              PDF
            </button>
          </div>
        </div>

        {prefillBoxes.length > 0 && (
          <div className="rounded-lg bg-slate-50 border border-slate-100 p-3 space-y-2">
            <p className="text-[11px] font-medium text-slate-500 uppercase tracking-wide">Din cursă</p>
            {prefillBoxes.map((box) => (
              <div key={box.id}>
                <p className="text-[11px] text-slate-400">{box.box}. {box.label}</p>
                <p className="text-sm text-slate-700 whitespace-pre-wrap">{form[box.id] || '—'}</p>
              </div>
            ))}
          </div>
        )}

        {priorStageBoxes.length > 0 && (
          <div className="rounded-lg bg-slate-50 border border-slate-100 p-3 space-y-2">
            <p className="text-[11px] font-medium text-slate-500 uppercase tracking-wide">La încărcare</p>
            {priorStageBoxes.map((box) => (
              <div key={box.id}>
                <p className="text-[11px] text-slate-400">{box.box}. {box.label}</p>
                <p className="text-sm text-slate-700 whitespace-pre-wrap">{form[box.id] ?? '—'}</p>
              </div>
            ))}
          </div>
        )}

        <div className="space-y-3">
          {editableBoxes.map((box) => (
            <div key={box.id}>
              <label className="block text-xs font-medium text-slate-600 mb-1">
                {box.box}. {box.label}
                {box.required ? ' *' : ''}
              </label>
              {box.multiline ? (
                <textarea
                  rows={3}
                  disabled={stageLocked || fullySigned}
                  className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg disabled:bg-slate-50"
                  value={form[box.id] ?? ''}
                  onChange={(e) => setField(box.id, e.target.value)}
                />
              ) : (
                <input
                  type={box.type === 'number' || box.type === 'integer' ? 'number' : box.type === 'date' ? 'date' : 'text'}
                  step={box.type === 'number' ? '0.01' : undefined}
                  disabled={stageLocked || fullySigned}
                  className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg disabled:bg-slate-50"
                  value={form[box.id] ?? ''}
                  onChange={(e) => setField(box.id, e.target.value)}
                />
              )}
            </div>
          ))}
        </div>

        {!fullySigned && signatureBoxes.length > 0 && (
          <div className="space-y-3 pt-2 border-t border-slate-100">
            {signatureBoxes.map((sig) => (
              <SignedOrPad
                key={sig.id}
                label={`${sig.box}. ${sig.label}${sig.required ? ' *' : ''}`}
                value={model.signatures?.[sig.id] || null}
                disabled={stageLocked}
                padRef={(el) => { sigRefs.current[sig.id] = el; }}
              />
            ))}
          </div>
        )}

        {!fullySigned && !stageLocked && (
          <div className="flex flex-col sm:flex-row gap-2 pt-1">
            <button
              type="button"
              onClick={saveDraft}
              disabled={saving || signing}
              className="flex-1 inline-flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-medium text-[#0A2B4E] bg-white border border-slate-200 rounded-lg disabled:opacity-50"
            >
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
              Salvează ciornă
            </button>
            <button
              type="button"
              onClick={signStage}
              disabled={saving || signing}
              className="flex-1 inline-flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-medium text-white bg-[#27AE60] rounded-lg disabled:opacity-50"
            >
              {signing ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
              Semnează {stage === 'incarcare' ? 'încărcarea' : 'livrarea'}
            </button>
          </div>
        )}
      </div>

      {showBatchUpload && (
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-5 space-y-3">
          <div>
            <h3 className="text-sm font-semibold text-[#0A2B4E]">Documente pe lot (birou)</h3>
            <p className="text-xs text-slate-500 mt-0.5">
              Pozele intră în același lot ca upload-ul din Documente — OCR și confirmare pe birou.
            </p>
          </div>
          <div className="flex flex-wrap gap-2 items-end">
            <div>
              <label className="block text-[11px] text-slate-500 mb-1">Tip</label>
              <select
                value={docType}
                onChange={(e) => setDocType(e.target.value)}
                className="px-2 py-1.5 text-xs border border-slate-200 rounded-md bg-white"
              >
                {DOC_TYPES.map((t) => (
                  <option key={t.value} value={t.value}>{t.label}</option>
                ))}
              </select>
            </div>
            <input
              ref={fileRef}
              type="file"
              accept="image/*,application/pdf"
              capture="environment"
              multiple
              className="hidden"
              onChange={onUploadFiles}
            />
            <button
              type="button"
              disabled={uploading}
              onClick={() => fileRef.current?.click()}
              className="inline-flex items-center gap-2 px-3 py-1.5 text-xs font-medium text-white bg-[#0A2B4E] rounded-lg disabled:opacity-50"
            >
              {uploading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Camera className="w-3.5 h-3.5" />}
              Încarcă pe lot
            </button>
          </div>
          {roadDocs.length > 0 ? (
            <ul className="divide-y divide-slate-100 border border-slate-100 rounded-lg overflow-hidden">
              {roadDocs.map((doc) => (
                <li key={doc.id} className="px-3 py-2 flex items-center gap-2 text-sm">
                  <FileText className="w-4 h-4 text-slate-400 shrink-0" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium text-slate-700">{doc.original_filename}</p>
                    <p className="text-[11px] text-slate-400">
                      {doc.document_type} · {doc.status}
                      {doc.needs_review ? ' · de revizuit' : ''}
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-xs text-slate-400">Niciun document pe lot încă.</p>
          )}
        </div>
      )}
    </div>
  );
}
