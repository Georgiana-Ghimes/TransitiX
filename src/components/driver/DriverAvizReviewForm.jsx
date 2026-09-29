import React, { useEffect, useMemo, useRef, useState } from 'react';
import { AlertCircle, CheckCircle2, ImagePlus, Loader2, X } from 'lucide-react';
import { api } from '@/api/client';
import { notifyError, notifySuccess } from '@/lib/notify';
import {
  DRIVER_LOGISTICS_FIELDS,
  DRIVER_SHEET_GUIDE,
  missingDriverLogistics,
} from '@/lib/driverAvizLogistics';

const fieldCls =
  'w-full min-h-[44px] px-3 py-2.5 text-sm border border-slate-200 rounded-lg bg-white focus:outline-none focus:border-[#1D4E89]';

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
          photo ? 'Datele + poza au ajuns la birou.' : 'Datele au ajuns la birou.',
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
    <div className="space-y-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex items-start gap-2">
        <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
        <div className="min-w-0">
          <p className="text-sm font-semibold text-[#0A2B4E]">
            {isCreate ? 'Completează aviz manual' : 'Completează câmpurile din aviz'}
          </p>
          <p className="mt-0.5 text-xs leading-relaxed text-slate-500">
            {isCreate
              ? 'Completează câmpurile de pe foaie. La final poți atașa o poză din galerie (opțional).'
              : 'OCR a citit fișierul. Verifică și completează ce lipsește — fără astea documentul nu e finalizat.'}
          </p>
        </div>
      </div>

      {missing.length > 0 ? (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
          Verifică câmpurile următoare — datele nu sunt complete:{' '}
          <span className="font-medium">{missing.map((m) => m.label).join(', ')}</span>
        </div>
      ) : (
        <div className="flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-900">
          <CheckCircle2 className="h-3.5 w-3.5" />
          Toate câmpurile obligatorii sunt completate.
        </div>
      )}

      <div className="space-y-2.5">
        {DRIVER_LOGISTICS_FIELDS.map((f) => {
          const highlight = missingKeys.has(f.key)
            || (f.key === 'cantitate_marfa' && missingKeys.has('cantitate_sau_greutate'))
            || (f.key === 'gross_weight_kg' && missingKeys.has('cantitate_sau_greutate'));
          return (
            <div key={f.key} className="min-w-0">
              <label className="mb-1 block text-[11px] font-medium text-slate-500">
                {f.sheetNo}. {f.label}
              </label>
              <input
                type={f.type === 'number' ? 'number' : f.type === 'date' ? 'date' : 'text'}
                step={f.type === 'number' ? 'any' : undefined}
                value={form[f.key] ?? ''}
                onChange={(e) => setField(f.key, e.target.value)}
                className={`${fieldCls} ${highlight ? 'border-amber-400 bg-amber-50/40' : ''}`}
                autoCapitalize="characters"
              />
            </div>
          );
        })}
      </div>

      {isCreate ? (
        <div className="space-y-2 rounded-lg border border-dashed border-slate-200 bg-slate-50/80 p-3">
          <p className="text-[11px] font-medium text-slate-500">Poză / fișier (opțional)</p>
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
            <div className="flex items-center gap-2 text-sm text-slate-700">
              <ImagePlus className="h-4 w-4 shrink-0 text-[#1D4E89]" />
              <span className="min-w-0 flex-1 truncate">{photo.name}</span>
              <button
                type="button"
                onClick={() => {
                  setPhoto(null);
                  if (photoRef.current) photoRef.current.value = '';
                }}
                className="rounded p-1 text-slate-400 hover:bg-white hover:text-slate-700"
                aria-label="Șterge poza"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => photoRef.current?.click()}
              className="inline-flex min-h-[44px] w-full items-center justify-center gap-2 rounded-lg border border-slate-200 bg-white px-3 text-sm font-medium text-[#0A2B4E]"
            >
              <ImagePlus className="h-4 w-4" />
              Adaugă din galerie
            </button>
          )}
        </div>
      ) : null}

      <div className="grid grid-cols-2 gap-2 pt-1">
        <button
          type="button"
          onClick={onCancel}
          className="min-h-[44px] rounded-lg border border-slate-200 bg-white px-3 text-sm font-medium text-slate-700"
        >
          Închide
        </button>
        <button
          type="button"
          disabled={saving || missing.length > 0}
          onClick={submit}
          className="inline-flex min-h-[44px] items-center justify-center gap-2 rounded-lg bg-[#0A2B4E] px-3 text-sm font-medium text-white disabled:opacity-50"
        >
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
          {isCreate ? 'Trimite aviz' : 'Confirmă'}
        </button>
      </div>
    </div>
  );
}

/** Tips when photographing a printed aviz for OCR. */
export function DriverWritingTips() {
  return (
    <div className="rounded-xl border border-sky-100 bg-sky-50/80 px-4 py-3">
      <p className="text-sm font-semibold text-[#0A2B4E]">Pentru poza la aviz tipărit</p>
      <ul className="mt-1.5 list-disc space-y-1 pl-4 text-xs leading-relaxed text-slate-600">
        <li>Încadrează toată foaia, lumină bună, fără umbră pe text.</li>
        <li>Dacă OCR lasă goluri, formularul se deschide automat pe câmpurile lipsă.</li>
      </ul>
      <p className="mt-2 text-[11px] font-medium text-slate-500">Ordinea pe foaie (ajută OCR pe carnet):</p>
      <ol className="mt-1 space-y-0.5 text-xs text-slate-700">
        {DRIVER_SHEET_GUIDE.map((g) => (
          <li key={g.no}>
            <span className="font-semibold">{g.no}.</span> {g.hint}
          </li>
        ))}
      </ol>
    </div>
  );
}
