import React, { useRef, useState } from 'react';
import { CheckCircle2, FileSpreadsheet, Loader2, TriangleAlert, Upload, X } from 'lucide-react';
import { api } from '@/api/client';
import ModalShell from '@/components/ModalShell';
import { notifyError, notifySuccess } from '@/lib/notify';

const TEMPLATE_HEADERS = [
  'Numar comanda', 'Client', 'Locatie', 'Data', 'Tip', 'De la', 'Pana la',
  'Greutate', 'Volum', 'Paleti', 'Cerinte', 'Marfa', 'Observatii',
];

/** A file the dispatcher can open in Excel, fill in and send straight back. */
function downloadTemplate(date) {
  const example = [
    'CMD-EXEMPLU-01', 'Alfa SRL', 'Depozit Cluj', date, 'livrare', '08:00', '12:00',
    '1250', '4,5', '3', 'ADR;frigo', 'Bauturi', '',
  ];
  const csv = `\uFEFF${[TEMPLATE_HEADERS, example].map((row) => row.join(';')).join('\r\n')}\r\n`;
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = 'sablon-import-comenzi.csv';
  link.click();
  URL.revokeObjectURL(url);
}

/**
 * Import orders from a spreadsheet.
 *
 * The preview is not cosmetic: the server runs the same plan for the dry run and for the
 * real import, so what the dispatcher approves is exactly what gets written. Lines with
 * problems are never imported silently — they stay listed with the reason.
 */
export default function OrderImportModal({ date, onClose, onImported }) {
  const [file, setFile] = useState(null);
  const [plan, setPlan] = useState(null);
  const [busy, setBusy] = useState(null);
  const inputRef = useRef(null);

  const preview = async (chosen) => {
    setFile(chosen);
    setPlan(null);
    if (!chosen) return;
    setBusy('preview');
    try {
      const result = await api.orders.import(chosen, { dryRun: true, defaultDate: date });
      setPlan(result.plan);
    } catch (e) {
      setPlan(e?.data?.plan || null);
      notifyError('Fișierul nu a putut fi analizat', e);
    } finally {
      setBusy(null);
    }
  };

  const apply = async () => {
    setBusy('apply');
    try {
      const result = await api.orders.import(file, { dryRun: false, defaultDate: date });
      notifySuccess(
        'Import finalizat',
        `${result.imported} ${result.imported === 1 ? 'comandă adăugată' : 'comenzi adăugate'}.`
      );
      onImported?.();
    } catch (e) {
      notifyError('Importul a eșuat', e);
    } finally {
      setBusy(null);
    }
  };

  const summary = plan?.summary;
  const canApply = Boolean(file) && summary?.ok > 0 && !busy;

  return (
    <ModalShell onClose={onClose} panelClassName="max-w-4xl" labelledBy="order-import-title">
      <div className="flex items-center justify-between p-4 border-b border-slate-100 sticky top-0 bg-white z-10">
        <h2 id="order-import-title" className="font-semibold text-[#0A2B4E] flex items-center gap-2">
          <FileSpreadsheet className="w-4 h-4 text-[#F5A623]" /> Import comenzi
        </h2>
        <button onClick={onClose} aria-label="Închide" className="p-1 text-slate-400 hover:text-slate-600">
          <X className="w-5 h-5" />
        </button>
      </div>

      <div className="p-4 space-y-4">
        <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-xs text-slate-600 space-y-1">
          <p>
            Acceptăm <strong>.xlsx</strong> și <strong>.csv</strong>. Prima linie trebuie să fie capul de tabel;
            recunoaștem denumirile uzuale („Număr comandă”, „Locație”, „Data”, „Greutate”, „Paleți”…).
          </p>
          <p>
            <strong>Locația trebuie să existe deja</strong> — o potrivim după nume sau adresă. Liniile fără
            locație nu se importă. Fără coloana Data, comenzile primesc data selectată pe board ({date}).
          </p>
          <button
            type="button"
            onClick={() => downloadTemplate(date)}
            className="text-[#1D4E89] font-medium hover:underline"
          >
            Descarcă șablonul
          </button>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <input
            ref={inputRef}
            type="file"
            accept=".xlsx,.xls,.csv,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            className="hidden"
            onChange={(e) => preview(e.target.files?.[0] || null)}
          />
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            disabled={busy === 'apply'}
            className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-[#0A2B4E] bg-white border border-slate-200 rounded-lg hover:bg-slate-50 disabled:opacity-50"
          >
            <Upload className="w-4 h-4" /> {file ? 'Alege alt fișier' : 'Alege fișierul'}
          </button>
          {file && <span className="text-xs text-slate-500 truncate max-w-[240px]">{file.name}</span>}
          {busy === 'preview' && <Loader2 className="w-4 h-4 animate-spin text-[#1D4E89]" />}
        </div>

        {summary && (
          <div className="flex flex-wrap gap-2 text-xs">
            <span className="px-2.5 py-1 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200 font-medium">
              {summary.ok} de importat
            </span>
            {summary.errors > 0 && (
              <span className="px-2.5 py-1 rounded-full bg-red-50 text-red-700 border border-red-200 font-medium">
                {summary.errors} cu probleme
              </span>
            )}
            {summary.warnings > 0 && (
              <span className="px-2.5 py-1 rounded-full bg-amber-50 text-amber-700 border border-amber-200 font-medium">
                {summary.warnings} cu atenționări
              </span>
            )}
            {plan.truncated > 0 && (
              <span className="px-2.5 py-1 rounded-full bg-slate-100 text-slate-600 border border-slate-200">
                {plan.truncated} linii peste limită, ignorate
              </span>
            )}
            {plan.headers?.unknown?.length > 0 && (
              <span className="px-2.5 py-1 rounded-full bg-slate-100 text-slate-600 border border-slate-200">
                Coloane necunoscute: {plan.headers.unknown.join(', ')}
              </span>
            )}
          </div>
        )}

        {plan?.rows?.length > 0 && (
          <>
            {/* Cards under md, table from md up — the same pattern as the rest of the office UI. */}
            <div className="md:hidden space-y-2 max-h-[45vh] overflow-y-auto">
              {plan.rows.map((row) => (
                <article
                  key={row.line}
                  className={`p-3 rounded-lg border text-xs ${
                    row.status === 'ok' ? 'border-slate-200 bg-white' : 'border-red-200 bg-red-50/50'
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium text-slate-700">{row.order.order_number || `Linia ${row.line}`}</span>
                    <span className="text-slate-400 tabular-nums">linia {row.line}</span>
                  </div>
                  <p className="text-slate-500 mt-0.5">
                    {row.matched?.location_name || '—'} · {row.order.requested_date} · {row.order.type}
                  </p>
                  {row.errors.map((error, i) => (
                    <p key={i} className="text-red-600 mt-1">{error}</p>
                  ))}
                  {row.warnings.map((warning, i) => (
                    <p key={i} className="text-amber-600 mt-1">{warning}</p>
                  ))}
                </article>
              ))}
            </div>

            <div className="hidden md:block overflow-x-auto max-h-[45vh] overflow-y-auto border border-slate-200 rounded-lg">
              <table className="w-full min-w-[720px] text-xs">
                <thead className="bg-slate-50 sticky top-0">
                  <tr className="text-left text-slate-500">
                    <th className="px-3 py-2 font-medium">Linie</th>
                    <th className="px-3 py-2 font-medium">Comandă</th>
                    <th className="px-3 py-2 font-medium">Locație</th>
                    <th className="px-3 py-2 font-medium">Data</th>
                    <th className="px-3 py-2 font-medium text-right">Kg</th>
                    <th className="px-3 py-2 font-medium">Stare</th>
                  </tr>
                </thead>
                <tbody>
                  {plan.rows.map((row) => (
                    <tr
                      key={row.line}
                      className={`border-t border-slate-100 ${row.status === 'ok' ? '' : 'bg-red-50/40'}`}
                    >
                      <td className="px-3 py-2 text-slate-400 tabular-nums">{row.line}</td>
                      <td className="px-3 py-2 font-medium text-slate-700">{row.order.order_number || '—'}</td>
                      <td className="px-3 py-2 text-slate-600">
                        {row.matched?.location_name || '—'}
                        {row.matched && !row.matched.geocoded && (
                          <span className="ml-1 text-[10px] text-amber-600">fără pin</span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-slate-600 tabular-nums">{row.order.requested_date || '—'}</td>
                      <td className="px-3 py-2 text-slate-600 text-right tabular-nums">
                        {row.order.weight_kg ? Number(row.order.weight_kg).toLocaleString('ro-RO') : ''}
                      </td>
                      <td className="px-3 py-2">
                        {row.status === 'ok' ? (
                          <span className="inline-flex items-center gap-1 text-emerald-600">
                            <CheckCircle2 className="w-3.5 h-3.5" /> ok
                          </span>
                        ) : (
                          <span className="inline-flex items-start gap-1 text-red-600">
                            <TriangleAlert className="w-3.5 h-3.5 shrink-0 mt-px" /> {row.errors.join('; ')}
                          </span>
                        )}
                        {row.warnings.length > 0 && (
                          <p className="text-amber-600 mt-0.5">{row.warnings.join('; ')}</p>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>

      <div className="flex items-center justify-end gap-2 p-4 border-t border-slate-100 sticky bottom-0 bg-white">
        <button
          onClick={onClose}
          className="px-4 py-2 text-sm font-medium text-slate-600 bg-white border border-slate-200 rounded-lg hover:bg-slate-50"
        >
          Renunță
        </button>
        <button
          onClick={apply}
          disabled={!canApply}
          className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-[#0A2B4E] rounded-lg hover:bg-[#1D4E89] disabled:opacity-40"
        >
          {busy === 'apply' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
          {summary?.ok ? `Importă ${summary.ok}` : 'Importă'}
        </button>
      </div>
    </ModalShell>
  );
}
