import React, { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { api } from '@/api/client';
import { friendlyErrorMessage } from '@/lib/notify';

const ROUTING_LABEL = {
  auto: 'Auto',
  hitl_optional: 'Verificare opțională',
  hitl_required: 'Verificare obligatorie',
  unknown: 'Fără rutare (vechi)',
};

/** Accurate percent: whole numbers when clean, one decimal otherwise. */
function pct(value) {
  if (value == null || Number.isNaN(Number(value))) return '-';
  const p = Number(value) * 100;
  if (!Number.isFinite(p)) return '-';
  const rounded = Math.round(p * 10) / 10;
  if (Math.abs(rounded - Math.round(rounded)) < 0.05) return `${Math.round(rounded)} %`;
  return `${rounded.toFixed(1)} %`;
}

function fmtExample(value) {
  if (value == null || value === '') return '∅';
  return String(value);
}

/**
 * Faza 4 - what people fix after OCR, over the list's upload-date range.
 */
export default function OcrQualityCard({ from, to }) {
  const [state, setState] = useState({ loading: true, error: '', data: null });

  useEffect(() => {
    let cancelled = false;
    setState((s) => ({ ...s, loading: true, error: '' }));
    api.documents.feedback({ from, to })
      .then((data) => { if (!cancelled) setState({ loading: false, error: '', data }); })
      .catch((err) => {
        if (!cancelled) setState({ loading: false, error: friendlyErrorMessage(err, 'Calitatea OCR nu s-a încărcat'), data: null });
      });
    return () => { cancelled = true; };
  }, [from, to]);

  const data = state.data;
  const docs = data?.documents;

  return (
    <div className="rounded-xl border border-slate-300 bg-slate-50/80 p-4 space-y-4 shadow-sm">
      <div className="flex flex-wrap items-baseline gap-2 border-b border-slate-200 pb-2">
        <h2 className="text-sm font-semibold text-[#0A2B4E]">Calitate OCR</h2>
        <span className="text-xs text-slate-600">
          {data?.window ? `${data.window.from} → ${data.window.to}` : 'interval curent'}
          <span className="text-slate-400"> · pe data încărcării</span>
        </span>
        {state.loading ? <Loader2 className="w-3.5 h-3.5 animate-spin text-slate-500 ml-auto" /> : null}
      </div>

      {state.error ? (
        <p className="text-xs text-red-700 bg-red-50 border border-red-100 rounded-md px-2 py-1.5">{state.error}</p>
      ) : null}

      {data && (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <Stat label="Documente citite" value={docs.total} />
            <Stat
              label="Atinse de om"
              value={docs.touched}
              hint={docs.touch_rate != null ? `${pct(docs.touch_rate)} din citite` : 'nicio citire în interval'}
            />
            <Stat
              label="Editări pe câmpuri OCR"
              value={docs.corrections}
              hint={docs.corrections_per_touched_doc != null ? `${Number(docs.corrections_per_touched_doc).toFixed(2)} / document atins` : undefined}
            />
            <Stat
              label="Trecute auto"
              value={data.routing?.auto?.total ?? 0}
              hint={`touch ${pct(data.routing?.auto?.touch_rate)}`}
            />
          </div>
          {(docs.touched_outside_window > 0 || docs.corrections_outside_window > 0) ? (
            <p className="text-[11px] text-slate-500">
              +{docs.corrections_outside_window || 0} editări pe {docs.touched_outside_window || 0} documente
              citite în afara intervalului (nu intră în % de mai sus).
            </p>
          ) : null}

          <div className="grid gap-4 lg:grid-cols-2">
            <div className="rounded-lg border border-slate-200 bg-white overflow-x-auto">
              <h3 className="text-xs font-semibold text-slate-700 px-3 pt-2.5 mb-1">Pe bandă de rutare</h3>
              <table className="w-full text-sm min-w-[300px]">
                <thead>
                  <tr className="text-xs text-slate-600 border-b border-slate-200 bg-slate-100/80">
                    <th className="text-left py-1.5 px-3 font-medium">Rutare</th>
                    <th className="text-right py-1.5 px-2 font-medium">Documente</th>
                    <th className="text-right py-1.5 px-2 font-medium">Atinse</th>
                    <th className="text-right py-1.5 px-3 font-medium">Touch rate</th>
                  </tr>
                </thead>
                <tbody>
                  {Object.entries(data.routing || {})
                    .filter(([key, row]) => row.total > 0 || key !== 'unknown')
                    .map(([key, row]) => (
                      <tr key={key} className="border-b border-slate-100 last:border-0">
                        <td className="py-1.5 px-3 text-slate-800">{ROUTING_LABEL[key] || key}</td>
                        <td className="py-1.5 px-2 text-right tabular-nums">{row.total}</td>
                        <td className="py-1.5 px-2 text-right tabular-nums">{row.touched}</td>
                        <td className="py-1.5 px-3 text-right tabular-nums font-medium text-[#0A2B4E]">{pct(row.touch_rate)}</td>
                      </tr>
                    ))}
                </tbody>
              </table>
              <p className="text-[11px] text-slate-500 px-3 py-2 border-t border-slate-100">
                Ideal: „auto” aproape de 0 % touch, „obligatorie” aproape de 100 %. Dacă „opțională” rămâne neatinsă, pragul trimite prea mult la verificare.
              </p>
            </div>

            <div className="rounded-lg border border-slate-200 bg-white overflow-x-auto">
              <h3 className="text-xs font-semibold text-slate-700 px-3 pt-2.5 mb-1">
                Editări pe câmpuri OCR
                <span className="font-normal text-slate-500"> · toate câmpurile schema</span>
              </h3>
              {(data.fields || []).length === 0 ? (
                <p className="text-sm text-slate-500 px-3 py-3">Nicio editare pe câmpuri OCR în interval.</p>
              ) : (
                <table className="w-full text-sm min-w-[340px]">
                  <thead>
                    <tr className="text-xs text-slate-600 border-b border-slate-200 bg-slate-100/80">
                      <th className="text-left py-1.5 px-3 font-medium">Câmp</th>
                      <th className="text-right py-1.5 px-2 font-medium">Editări</th>
                      <th className="text-right py-1.5 px-2 font-medium">Documente</th>
                      <th className="text-right py-1.5 px-2 font-medium">% din citite</th>
                      <th className="text-left py-1.5 pl-2 pr-3 font-medium">Exemplu</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.fields.map((f) => (
                      <tr key={f.field} className="border-b border-slate-100 last:border-0">
                        <td className="py-1.5 px-3">
                          <span className="text-slate-800">{f.label}</span>
                          {f.critical ? (
                            <span className="ml-1.5 text-[10px] uppercase tracking-wide text-red-800 bg-red-50 border border-red-100 px-1 py-px rounded">
                              critic
                            </span>
                          ) : null}
                        </td>
                        <td className="py-1.5 px-2 text-right tabular-nums font-medium text-[#0A2B4E]">{f.corrections}</td>
                        <td className="py-1.5 px-2 text-right tabular-nums">{f.documents}</td>
                        <td className="py-1.5 px-2 text-right tabular-nums">{pct(f.doc_rate)}</td>
                        <td
                          className="py-1.5 pl-2 pr-3 text-xs text-slate-600 truncate max-w-[160px]"
                          title={f.examples.map((e) => `${fmtExample(e.from)} → ${fmtExample(e.to)}`).join('\n')}
                        >
                          {f.examples[0] ? `${fmtExample(f.examples[0].from)} → ${fmtExample(f.examples[0].to)}` : '-'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>

          {(data.rules || []).length > 0 && (
            <div>
              <h3 className="text-xs font-semibold text-slate-700 mb-1.5">Reguli de validare care au picat</h3>
              <div className="flex flex-wrap gap-1.5">
                {data.rules.map((r) => (
                  <span
                    key={r.rule}
                    className="text-[11px] px-2 py-0.5 rounded-md border border-slate-200 bg-white text-slate-700"
                  >
                    {r.rule} · {r.documents} ({pct(r.doc_rate)})
                  </span>
                ))}
              </div>
            </div>
          )}

          <div className="rounded-lg border border-slate-200 bg-white px-3 py-2.5">
            <h3 className="text-xs font-semibold text-slate-700 mb-1">Ce ar merita ajustat</h3>
            {!data.enough_data ? (
              <p className="text-xs text-slate-600">
                Sub {data.min_docs_for_suggestions} documente citite în interval — prea puține ca o recomandare să însemne ceva. Lărgește intervalul.
              </p>
            ) : (data.suggestions || []).length === 0 ? (
              <p className="text-xs text-emerald-800 bg-emerald-50 border border-emerald-100 rounded-md px-2 py-1.5">
                Nimic ieșit din tipar: pragurile și profilul se țin bine pe acest interval.
              </p>
            ) : (
              <ul className="space-y-1">
                {data.suggestions.map((s, i) => (
                  <li
                    key={`${s.kind}-${s.field || s.rule || i}`}
                    className="text-xs text-amber-950 bg-amber-50 border border-amber-100 rounded-md px-2 py-1.5"
                  >
                    {s.message}
                  </li>
                ))}
              </ul>
            )}
            <p className="text-[11px] text-slate-500 mt-2">
              Nimic nu se schimbă singur: pragurile și profilurile OCR se ajustează de un om, în cod, ca o lună veche să se poată recalcula la fel.
            </p>
          </div>
        </>
      )}
    </div>
  );
}

function Stat({ label, value, hint }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white px-3 py-2.5 shadow-sm">
      <div className="text-[10px] uppercase tracking-wide text-slate-500 font-medium">{label}</div>
      <div className="text-xl font-semibold text-[#0A2B4E] tabular-nums leading-tight mt-0.5">{value ?? '-'}</div>
      {hint ? <div className="text-[11px] text-slate-600 mt-0.5">{hint}</div> : null}
    </div>
  );
}
