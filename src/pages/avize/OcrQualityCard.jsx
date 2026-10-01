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

function pct(value) {
  if (value == null) return '-';
  return `${Math.round(Number(value) * 100)} %`;
}

function fmtExample(value) {
  if (value == null || value === '') return '∅';
  return String(value);
}

/**
 * Faza 4 - what people fix after OCR, over the list's date range.
 *
 * The numbers describe the window the operator is already looking at, so a question like
 * "was September worse?" is answered by moving the same filter, not a second one. The card
 * never suggests anything under the minimum sample; a loud recommendation off three
 * documents would be acted on and then regretted.
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
    <div className="bg-white rounded-xl border border-slate-200/80 p-4 space-y-4">
      <div className="flex flex-wrap items-baseline gap-2">
        <h2 className="text-sm font-semibold text-[#0A2B4E]">Calitate OCR</h2>
        <span className="text-xs text-slate-500">
          {data?.window ? `${data.window.from} → ${data.window.to}` : 'interval curent'}
        </span>
        {state.loading ? <Loader2 className="w-3.5 h-3.5 animate-spin text-slate-400 ml-auto" /> : null}
      </div>

      {state.error ? (
        <p className="text-xs text-red-700">{state.error}</p>
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
            <Stat label="Corecții de câmp" value={docs.corrections} hint={docs.corrections_per_touched_doc != null ? `${docs.corrections_per_touched_doc} / document atins` : undefined} />
            <Stat
              label="Trecute auto"
              value={data.routing?.auto?.total ?? 0}
              hint={`touch ${pct(data.routing?.auto?.touch_rate)}`}
            />
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <div className="overflow-x-auto">
              <h3 className="text-xs font-semibold text-slate-700 mb-2">Pe bandă de rutare</h3>
              <table className="w-full text-sm min-w-[300px]">
                <thead>
                  <tr className="text-xs text-slate-500 border-b">
                    <th className="text-left py-1.5">Rutare</th>
                    <th className="text-right py-1.5">Documente</th>
                    <th className="text-right py-1.5">Atinse</th>
                    <th className="text-right py-1.5">Touch rate</th>
                  </tr>
                </thead>
                <tbody>
                  {Object.entries(data.routing || {})
                    .filter(([key, row]) => row.total > 0 || key !== 'unknown')
                    .map(([key, row]) => (
                      <tr key={key} className="border-b border-slate-50">
                        <td className="py-1.5">{ROUTING_LABEL[key] || key}</td>
                        <td className="py-1.5 text-right">{row.total}</td>
                        <td className="py-1.5 text-right">{row.touched}</td>
                        <td className="py-1.5 text-right">{pct(row.touch_rate)}</td>
                      </tr>
                    ))}
                </tbody>
              </table>
              <p className="text-[11px] text-slate-500 mt-2">
                Ideal: „auto” aproape de 0 %, „obligatorie” aproape de 100 %. Dacă „opțională” rămâne neatinsă, pragul trimite prea mult la verificare.
              </p>
            </div>

            <div className="overflow-x-auto">
              <h3 className="text-xs font-semibold text-slate-700 mb-2">Câmpuri corectate cel mai des</h3>
              {(data.fields || []).length === 0 ? (
                <p className="text-sm text-slate-400">Nicio corecție în interval.</p>
              ) : (
                <table className="w-full text-sm min-w-[300px]">
                  <thead>
                    <tr className="text-xs text-slate-500 border-b">
                      <th className="text-left py-1.5">Câmp</th>
                      <th className="text-right py-1.5">Documente</th>
                      <th className="text-right py-1.5">% din citite</th>
                      <th className="text-left py-1.5 pl-3">Exemplu</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.fields.slice(0, 8).map((f) => (
                      <tr key={f.field} className="border-b border-slate-50">
                        <td className="py-1.5">
                          {f.label}
                          {f.critical ? <span className="ml-1 text-[10px] uppercase text-red-700">critic</span> : null}
                        </td>
                        <td className="py-1.5 text-right">{f.documents}</td>
                        <td className="py-1.5 text-right">{pct(f.doc_rate)}</td>
                        <td className="py-1.5 pl-3 text-xs text-slate-500 truncate max-w-[180px]" title={f.examples.map((e) => `${fmtExample(e.from)} → ${fmtExample(e.to)}`).join('\n')}>
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
              <h3 className="text-xs font-semibold text-slate-700 mb-1">Reguli de validare care au picat</h3>
              <div className="flex flex-wrap gap-1.5">
                {data.rules.map((r) => (
                  <span key={r.rule} className="text-[11px] px-2 py-0.5 rounded-full bg-slate-100 text-slate-700">
                    {r.rule} · {r.documents} ({pct(r.doc_rate)})
                  </span>
                ))}
              </div>
            </div>
          )}

          <div className="rounded-lg border border-slate-100 bg-slate-50/70 px-3 py-2">
            <h3 className="text-xs font-semibold text-slate-700 mb-1">Ce ar merita ajustat</h3>
            {!data.enough_data ? (
              <p className="text-xs text-slate-500">
                Sub {data.min_docs_for_suggestions} documente citite în interval - prea puține ca o recomandare să însemne ceva. Lărgește intervalul.
              </p>
            ) : (data.suggestions || []).length === 0 ? (
              <p className="text-xs text-emerald-800">Nimic ieșit din tipar: pragurile și profilul se țin bine pe acest interval.</p>
            ) : (
              <ul className="space-y-1">
                {data.suggestions.map((s, i) => (
                  <li key={`${s.kind}-${s.field || s.rule || i}`} className="text-xs text-amber-900">
                    {s.message}
                  </li>
                ))}
              </ul>
            )}
            <p className="text-[11px] text-slate-400 mt-2">
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
    <div className="rounded-lg border border-slate-100 px-3 py-2">
      <div className="text-[11px] uppercase tracking-wide text-slate-500">{label}</div>
      <div className="text-xl font-semibold text-[#0A2B4E]">{value ?? '-'}</div>
      {hint ? <div className="text-[11px] text-slate-500">{hint}</div> : null}
    </div>
  );
}
