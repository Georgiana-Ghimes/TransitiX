import React, { useEffect, useMemo, useRef, useState } from 'react';
import { AlertCircle, CheckCircle2, ImagePlus, Loader2, X } from 'lucide-react';
import { api } from '@/api/client';
import { notifyError, notifySuccess } from '@/lib/notify';
import {
  DRIVER_LOGISTICS_FIELDS,
  DRIVER_SHEET_GUIDE,
  missingDriverLogistics,
} from '@/lib/driverAvizLogistics';
import {
  driverFieldCls,
  driverLabelCls,
  driverPrimaryBtn,
  driverSecondaryBtn,
} from '@/lib/driverUi';

function rowFromDoc(doc) {
  const out = {};
  for (const f of DRIVER_LOGISTICS_FIELDS) {
    const v = doc?.[f.key];
    out[f.key] = v == null ? '' : v;
  }
  return out;
}

/**
 * @param {'create'|'review'} mode
 * create = completează aviz manual (+ poză opțională la final)
 * review = după OCR din galerie
 */
export default function DriverAvizReviewForm({
  mode = 'review',
  doc,
  tripId,
  documentType = 'aviz',
  onSaved,
  onCancel,
}) {
  const isCreate = mode === 'create';
  const [form, setForm] = useState(() => (isCreate ? rowFromDoc({}) : rowFromDoc(doc)));
  const [saving, setSaving] = useState(false);
  const [serverMissing, setServerMissing] = useState(doc?.missing_fields || []);
  const [photo, setPhoto] = useState(null);
  const photoRef = useRef(null);

  useEffect(() => {
    if (isCreate) return;
    setForm(rowFromDoc(doc));
    setServerMissing(doc?.missing_fields || []);
  }, [isCreate, doc?.id, doc?.status, doc?.numar_tpo]);

  const missing = useMemo(() => {
    const local = missingDriverLogistics(form);
    return local.length ? local : serverMissing;
  }, [form, serverMissing]);

  const missingKeys = new Set(missing.map((m) => m.key));

  const setField = (key, value) => {
    setForm((prev) => ({ ...prev, [key]: value }));
    setServerMissing([]);
  };

  const submit = async () => {
    const still = missingDriverLogistics(form);
    if (still.length) {
      setServerMissing(still);
      notifyError(
        'Verifică câmpurile',
        `Lipsesc: ${still.map((m) => m.label).join(', ')}`,
      );
      return;
    }
    setSaving(true);
    try {
      const payload = {};
      for (const f of DRIVER_LOGISTICS_FIELDS) {
        payload[f.key] = form[f.key] === '' ? null : form[f.key];
      }

      if (isCreate) {
        const result = await api.driverDocuments.createManual({
          tripId: tripId || undefined,
          document_type: documentType,
          fields: payload,
          file: photo || undefined,
        });
        notifySuccess(
          'Aviz salvat',
          photo
            ? 'Datele + poza așteaptă verificarea biroului.'
            : 'Datele așteaptă verificarea biroului.',
        );
        onSaved?.(result.document);
      } else {
        const result = await api.driverDocuments.confirm(doc.id, payload);
        notifySuccess('Confirmat', 'Datele logistice sunt complete pe Avize.');
        onSaved?.(result.document);
      }
    } catch (err) {
      const miss = err?.data?.missing_fields || err?.payload?.missing_fields;
      if (Array.isArray(miss) && miss.length) setServerMissing(miss);
      notifyError(isCreate ? 'Nu am putut salva' : 'Nu am putut confirma', err);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-4 rounded-xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
      <div className="flex items-start gap-3">
        <AlertCircle className="mt-1 h-6 w-6 shrink-0 text-amber-600" />
        <div className="min-w-0">
          <p className="text-lg font-semibold text-[#0A2B4E] leading-snug">
            {isCreate ? 'Completează aviz manual' : 'Completează câmpurile din aviz'}
          </p>
          <p className="mt-1 text-base leading-relaxed text-slate-600">
            {isCreate
              ? 'Completează câmpurile de pe foaie. La final poți atașa o poză (opțional).'
              : 'Verifică și completează ce lipsește - fără astea documentul nu e finalizat.'}
          </p>
        </div>
      </div>

      {missing.length > 0 ? (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-base text-amber-950 leading-snug">
          Verifică câmpurile următoare:{' '}
          <span className="font-semibold">{missing.map((m) => m.label).join(', ')}</span>
        </div>
      ) : (
        <div className="flex items-start gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-base text-emerald-950">
          <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0" />
          Toate câmpurile obligatorii sunt completate.
        </div>
      )}

      <div className="space-y-4">
        {DRIVER_LOGISTICS_FIELDS.map((f) => {
          const highlight = missingKeys.has(f.key)
            || (f.key === 'cantitate_marfa' && missingKeys.has('cantitate_sau_greutate'))
            || (f.key === 'gross_weight_kg' && missingKeys.has('cantitate_sau_greutate'));
          return (
            <div key={f.key} className="min-w-0">
              <label className={driverLabelCls}>
                {f.sheetNo}. {f.label}
              </label>
              <input
                type={f.type === 'number' ? 'number' : f.type === 'date' ? 'date' : 'text'}
                step={f.type === 'number' ? 'any' : undefined}
                value={form[f.key] ?? ''}
                onChange={(e) => setField(f.key, e.target.value)}
                className={`${driverFieldCls} ${highlight ? 'border-amber-400 bg-amber-50/40' : ''}`}
                autoCapitalize="characters"
              />
            </div>
          );
        })}
      </div>

      {isCreate ? (
        <div className="space-y-3 rounded-xl border border-dashed border-slate-200 bg-slate-50/80 p-4">
          <p className={driverLabelCls}>Poză / fișier (opțional)</p>
          <input
            ref={photoRef}
            type="file"
            accept="image/*,application/pdf"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0] || null;
              setPhoto(f);
            }}
          />
          {photo ? (
            <div className="flex items-center gap-3 text-base text-slate-700">
              <ImagePlus className="h-5 w-5 shrink-0 text-[#1D4E89]" />
              <span className="min-w-0 flex-1 break-words">{photo.name}</span>
              <button
                type="button"
                onClick={() => {
                  setPhoto(null);
                  if (photoRef.current) photoRef.current.value = '';
                }}
                className="flex min-h-12 min-w-12 items-center justify-center rounded-lg text-slate-500 hover:bg-white hover:text-slate-700"
                aria-label="Șterge poza"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => photoRef.current?.click()}
              className={driverSecondaryBtn}
            >
              <ImagePlus className="h-5 w-5" />
              Adaugă din galerie
            </button>
          )}
        </div>
      ) : null}

      {/* Sticky confirm: always reachable after scrolling a long form at large text. */}
      <div
        className="sticky bottom-0 z-10 -mx-4 space-y-3 border-t border-slate-100 bg-white/95 px-4 pb-1 pt-3 backdrop-blur-sm sm:-mx-5 sm:px-5"
        style={{ paddingBottom: 'max(0.25rem, env(safe-area-inset-bottom))' }}
      >
        {missing.length > 0 ? (
          <p className="text-base font-medium leading-snug text-amber-800">
            Mai lipsesc: {missing.map((m) => m.label).join(', ')}
          </p>
        ) : null}
        <div className="flex flex-col gap-3">
          <button
            type="button"
            disabled={saving || missing.length > 0}
            onClick={submit}
            className={driverPrimaryBtn}
          >
            {saving ? <Loader2 className="h-5 w-5 animate-spin" /> : null}
            {isCreate ? 'Trimite avizul' : 'Confirmă'}
          </button>
          <button
            type="button"
            onClick={onCancel}
            className={driverSecondaryBtn}
          >
            Închide
          </button>
        </div>
      </div>
    </div>
  );
}

/** Tips when handwriting a sheet for OCR - always open, so it is seen before the camera. */
export function DriverWritingTips() {
  return (
    <div className="rounded-xl border-2 border-[#0A2B4E] bg-[#0A2B4E] text-white px-4 py-4 shadow-sm">
      <p className="text-lg font-bold leading-snug">
        Scrie pe foaie, în această ordine
      </p>
      <p className="mt-1 text-sm text-white/85 leading-relaxed">
        Dacă completezi pe hârtie și faci poză, numerotează rândurile 1-14 exact așa.
        Lasă gol ce nu știi - nu inventa cifre.
      </p>
      <ol className="mt-3 space-y-1.5 text-base leading-snug">
        {DRIVER_SHEET_GUIDE.map((g) => (
          <li key={g.no} className="flex gap-2">
            <span className="w-7 shrink-0 font-bold tabular-nums text-sky-200">{g.no}.</span>
            <span>{g.hint}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}
