import React, { useMemo, useRef, useState } from 'react';
import { Loader2, Upload } from 'lucide-react';
import {
  SHARPNESS_MIN,
  isBlurry,
  measurePhotoSharpness,
  suggestThreshold,
} from '@/lib/imageQuality';

/**
 * Where `SHARPNESS_MIN` gets its number.
 *
 * The threshold was a guess, and a guess is either annoying (warns on readable photos) or useless
 * (misses blurred ones). This measures real avize with the same code the app runs — same decode,
 * same downscale, same Laplacian — so the number it suggests is the number that will behave.
 *
 * Development only: never routed in a production build.
 */
export default function SharpnessCalibration() {
  const [rows, setRows] = useState([]);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef(null);

  const add = async (fileList) => {
    const files = [...(fileList || [])];
    if (!files.length) return;
    setBusy(true);
    try {
      const measured = [];
      for (const file of files) {
        const score = await measurePhotoSharpness(file);
        measured.push({
          id: `${file.name}-${file.size}-${measured.length}`,
          name: file.name,
          url: URL.createObjectURL(file),
          score,
          readable: null,
        });
      }
      setRows((prev) => [...prev, ...measured]);
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const label = (id, readable) => {
    setRows((prev) => prev.map((r) => (r.id === id ? { ...r, readable } : r)));
  };

  const labelled = rows.filter((r) => r.readable !== null && Number.isFinite(r.score));
  const suggestion = useMemo(() => suggestThreshold(labelled), [labelled]);

  // How the threshold in the code today would do on the same photos — the comparison that
  // decides whether changing it is worth anything.
  const current = useMemo(() => ({
    falseWarnings: labelled.filter((r) => r.readable && r.score < SHARPNESS_MIN).length,
    missed: labelled.filter((r) => !r.readable && r.score >= SHARPNESS_MIN).length,
  }), [labelled]);

  const sorted = [...rows].sort((a, b) => (a.score ?? Infinity) - (b.score ?? Infinity));

  return (
    <div className="max-w-4xl mx-auto space-y-5">
      <div>
        <h1 className="text-xl font-bold text-[#0A2B4E]">Calibrare prag claritate</h1>
        <p className="text-sm text-slate-500 mt-1 leading-relaxed">
          Adaugă avize fotografiate — și clare, și mișcate. Marchează fiecare după cum îl vede un
          om: <strong>Citibil</strong> dacă ai putea prelua datele de pe el, <strong>Neclar</strong>
          {' '}dacă nu. Pragul sugerat mai jos e cel care greșește cel mai puțin.
        </p>
      </div>

      <div className="bg-white rounded-xl border border-slate-200/80 shadow-sm p-4 space-y-3">
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          multiple
          className="hidden"
          onChange={(e) => add(e.target.files)}
        />
        <button
          type="button"
          disabled={busy}
          onClick={() => fileRef.current?.click()}
          className="inline-flex items-center gap-2 min-h-[44px] px-4 text-sm font-medium text-white bg-[#0A2B4E] rounded-lg disabled:opacity-50"
        >
          {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
          Adaugă poze
        </button>
        {rows.length > 0 && (
          <button
            type="button"
            onClick={() => setRows([])}
            className="ml-2 text-sm text-slate-500 hover:underline"
          >
            Golește lista
          </button>
        )}
      </div>

      {labelled.length > 0 && (
        <div className="bg-white rounded-xl border border-slate-200/80 shadow-sm p-4 space-y-2">
          <p className="text-sm font-semibold text-[#0A2B4E]">
            Prag sugerat: <span className="tabular-nums">{suggestion.threshold}</span>
            <span className="font-normal text-slate-500">
              {' '}(în cod acum: <span className="tabular-nums">{SHARPNESS_MIN}</span>)
            </span>
          </p>
          <p className="text-xs text-slate-500">
            {suggestion.readable} citibile, {suggestion.blurry} neclare.
            {' '}Cu pragul sugerat: {suggestion.falseWarnings} avertismente false,
            {' '}{suggestion.missed} poze mișcate ratate.
            {' '}Cu pragul actual: {current.falseWarnings} false, {current.missed} ratate.
          </p>
          {!suggestion.separable && (
            <p className="text-xs text-amber-700 bg-amber-50 border border-amber-100 rounded-lg px-3 py-2">
              Grupele se suprapun — nicio valoare nu le separă curat. Numărul de mai sus e un
              compromis, nu o linie. Mai multe poze îl fac mai sigur.
            </p>
          )}
          {suggestion.blurry < 5 && (
            <p className="text-xs text-slate-500">
              Sub 5 poze neclare, sugestia e fragilă. Adaugă câteva făcute intenționat prost.
            </p>
          )}
        </div>
      )}

      {sorted.length > 0 && (
        <div className="bg-white rounded-xl border border-slate-200/80 shadow-sm overflow-hidden">
          <ul className="divide-y divide-slate-100">
            {sorted.map((r) => (
              <li key={r.id} className="flex items-center gap-3 p-3">
                <img src={r.url} alt="" className="w-16 h-16 object-cover rounded border border-slate-200" />
                <div className="min-w-0 flex-1">
                  <p className="text-sm text-slate-700 truncate">{r.name}</p>
                  <p className="text-xs text-slate-500 tabular-nums">
                    {r.score == null ? 'nemăsurabil' : r.score.toFixed(1)}
                    {r.score != null && isBlurry(r.score) && (
                      <span className="text-amber-700"> · sub pragul actual</span>
                    )}
                  </p>
                </div>
                <div className="flex gap-1 shrink-0">
                  {[['Citibil', true], ['Neclar', false]].map(([text, value]) => (
                    <button
                      key={text}
                      type="button"
                      onClick={() => label(r.id, value)}
                      className={`px-3 py-1.5 text-xs rounded-lg border ${
                        r.readable === value
                          ? 'bg-[#0A2B4E] text-white border-[#0A2B4E]'
                          : 'bg-white text-slate-600 border-slate-200'
                      }`}
                    >
                      {text}
                    </button>
                  ))}
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
