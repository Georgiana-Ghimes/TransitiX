import React, { useState } from 'react';
import { Loader2, Trash2 } from 'lucide-react';
import { api } from '@/api/client';
import ConfirmDialog from '@/components/ConfirmDialog';
import { notifyError, notifySuccess } from '@/lib/notify';
import OcrQualityCard from './OcrQualityCard';

function exportWho(row) {
  return row.user_name || row.user_email || '-';
}

function Panel({ title, hint, children, actions }) {
  return (
    <div className="rounded-xl border border-slate-300 bg-slate-50/80 shadow-sm overflow-hidden">
      <div className="flex flex-wrap items-center gap-2 px-4 pt-3 pb-2 border-b border-slate-200 bg-white/70">
        <h2 className="text-sm font-semibold text-[#0A2B4E]">{title}</h2>
        {hint ? <span className="text-[11px] text-slate-500">{hint}</span> : null}
        {actions ? <div className="ml-auto">{actions}</div> : null}
      </div>
      <div className="p-3 bg-white">{children}</div>
    </div>
  );
}

export default function AvizReportsTab({ filterBar, reportData, onRefresh, range }) {
  const [pendingDelete, setPendingDelete] = useState(null); // { type: 'one'|'all', row? }
  const [deleting, setDeleting] = useState(false);
  const exports = reportData.exports || [];

  async function confirmDelete() {
    if (!pendingDelete) return;
    setDeleting(true);
    try {
      if (pendingDelete.type === 'all') {
        const res = await api.reports.clearExports();
        notifySuccess(res.deleted
          ? `Istoric șters (${res.deleted} export${res.deleted === 1 ? '' : 'uri'})`
          : 'Istoricul era deja gol');
      } else {
        await api.reports.deleteExport(pendingDelete.row.id);
        notifySuccess('Export șters din istoric');
      }
      setPendingDelete(null);
      await onRefresh?.();
    } catch (err) {
      notifyError('Ștergerea din istoric a eșuat', err);
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div className="space-y-4">
      {filterBar}
      <p className="text-xs text-slate-600 bg-slate-100 border border-slate-200 rounded-lg px-3 py-2">
        Sinteze pe <strong>data încărcării</strong> (aceeași ca lista Avize). Nu modifică șablonul Anexa Factura RAI —
        Unește rămâne pe tab-ul Avize OCR.
      </p>
      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title="Km / avize pe număr auto" hint="încărcare în interval">
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[280px]">
              <thead>
                <tr className="text-xs text-slate-600 border-b border-slate-200 bg-slate-100/80">
                  <th className="text-left py-2 px-1 font-medium">Auto</th>
                  <th className="text-right py-2 px-1 font-medium">Avize</th>
                  <th className="text-right py-2 px-1 font-medium">Km</th>
                </tr>
              </thead>
              <tbody>
                {(reportData.by_plate || []).length === 0 ? (
                  <tr><td colSpan={3} className="py-3 text-slate-500 text-sm">Niciun aviz încărcat în interval.</td></tr>
                ) : (reportData.by_plate || []).map((row) => (
                  <tr key={row.plate} className="border-b border-slate-100 last:border-0">
                    <td className="py-2 px-1 text-slate-800">{row.plate}</td>
                    <td className="py-2 px-1 text-right tabular-nums font-medium text-[#0A2B4E]">{row.count}</td>
                    <td className="py-2 px-1 text-right tabular-nums text-slate-700">{row.km}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>
        <Panel title="Avize pe săptămână" hint="săptămână ISO · data încărcării">
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[280px]">
              <thead>
                <tr className="text-xs text-slate-600 border-b border-slate-200 bg-slate-100/80">
                  <th className="text-left py-2 px-1 font-medium">Săptămână (luni)</th>
                  <th className="text-right py-2 px-1 font-medium">Total</th>
                  <th className="text-right py-2 px-1 font-medium">Confirmate</th>
                </tr>
              </thead>
              <tbody>
                {(reportData.weekly || []).length === 0 ? (
                  <tr><td colSpan={3} className="py-3 text-slate-500 text-sm">Nicio săptămână în interval.</td></tr>
                ) : (reportData.weekly || []).map((row) => (
                  <tr key={row.week_start} className="border-b border-slate-100 last:border-0">
                    <td className="py-2 px-1 text-slate-800">{String(row.week_start).slice(0, 10)}</td>
                    <td className="py-2 px-1 text-right tabular-nums font-medium text-[#0A2B4E]">{row.count}</td>
                    <td className="py-2 px-1 text-right tabular-nums text-slate-700">{row.confirmed}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>
      </div>
      <OcrQualityCard from={range?.from} to={range?.to} />
      <Panel
        title="Istoric export"
        hint="ultimele 30 · fără filtru de dată"
        actions={(
          <button
            type="button"
            disabled={exports.length === 0 || deleting}
            onClick={() => setPendingDelete({ type: 'all' })}
            className="text-xs px-2 py-1 rounded border border-red-200 text-red-700 bg-white hover:bg-red-50 disabled:opacity-40 inline-flex items-center gap-1"
          >
            {deleting && pendingDelete?.type === 'all'
              ? <Loader2 className="w-3 h-3 animate-spin" />
              : <Trash2 className="w-3 h-3" />}
            Șterge tot istoricul
          </button>
        )}
      >
        <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[480px]">
            <thead>
              <tr className="text-xs text-slate-600 border-b border-slate-200 bg-slate-100/80">
                <th className="text-left py-2 px-1 font-medium">Când</th>
                <th className="text-left py-2 px-1 font-medium">Cine</th>
                <th className="text-left py-2 px-1 font-medium">Tip</th>
                <th className="text-left py-2 px-1 font-medium">Fișier</th>
                <th className="text-right py-2 px-1 font-medium">Avize</th>
                <th className="text-right py-2 px-1 w-20"> </th>
              </tr>
            </thead>
            <tbody>
              {exports.length === 0 ? (
                <tr><td colSpan={6} className="py-3 text-slate-500 text-sm">Niciun export încă.</td></tr>
              ) : exports.map((row) => (
                <tr key={row.id} className="border-b border-slate-100 last:border-0">
                  <td className="py-2 px-1 text-slate-800">{String(row.created_at || '').slice(0, 16).replace('T', ' ')}</td>
                  <td className="py-2 px-1 truncate text-slate-700" title={row.user_email || ''}>{exportWho(row)}</td>
                  <td className="py-2 px-1 text-slate-700">{row.kind}</td>
                  <td className="py-2 px-1 truncate text-slate-700">{row.filename || '-'}</td>
                  <td className="py-2 px-1 text-right tabular-nums font-medium text-[#0A2B4E]">{row.aviz_count ?? '-'}</td>
                  <td className="py-2 px-1 text-right">
                    <button
                      type="button"
                      disabled={deleting}
                      onClick={() => setPendingDelete({ type: 'one', row })}
                      className="text-xs px-2 py-1 rounded border border-red-200 text-red-700 hover:bg-red-50 disabled:opacity-40 inline-flex items-center gap-1"
                      title="Șterge din istoric"
                    >
                      <Trash2 className="w-3 h-3" />
                      Șterge
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>

      <ConfirmDialog
        open={Boolean(pendingDelete)}
        onClose={() => { if (!deleting) setPendingDelete(null); }}
        onConfirm={confirmDelete}
        busy={deleting}
        title={pendingDelete?.type === 'all' ? 'Ștergi tot istoricul de exporturi?' : 'Ștergi exportul din istoric?'}
        description={pendingDelete?.type === 'all'
          ? 'Se șterg toate înregistrările firmei. Nu vei mai putea re-descărca foile trimise. Avizele rămân neschimbate.'
          : `„${pendingDelete?.row?.filename || pendingDelete?.row?.kind || 'Export'}” dispare din istoric. Re-descărcarea nu mai e posibilă.`}
        confirmLabel="Șterge"
      />
    </div>
  );
}
