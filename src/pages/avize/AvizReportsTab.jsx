import React, { useState } from 'react';
import { Loader2, Trash2 } from 'lucide-react';
import { api } from '@/api/client';
import ConfirmDialog from '@/components/ConfirmDialog';
import { notifyError, notifySuccess } from '@/lib/notify';

function exportWho(row) {
  return row.user_name || row.user_email || '—';
}

export default function AvizReportsTab({ filterBar, reportData, onRefresh }) {
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
      <p className="text-xs text-slate-500">
        Sintezele nu modifică șablonul Anexa Factura RAI. Unește rămâne pe tab-ul Avize OCR.
      </p>
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="bg-white rounded-xl border border-slate-200/80 p-4 overflow-x-auto">
          <h2 className="text-sm font-semibold text-[#0A2B4E] mb-3">Km / avize pe număr auto</h2>
          <table className="w-full text-sm min-w-[280px]">
            <thead>
              <tr className="text-xs text-slate-500 border-b">
                <th className="text-left py-2">Auto</th>
                <th className="text-right py-2">Avize</th>
                <th className="text-right py-2">Km</th>
              </tr>
            </thead>
            <tbody>
              {(reportData.by_plate || []).length === 0 ? (
                <tr><td colSpan={3} className="py-3 text-slate-400 text-sm">Niciun aviz în interval.</td></tr>
              ) : (reportData.by_plate || []).map((row) => (
                <tr key={row.plate} className="border-b border-slate-50">
                  <td className="py-2">{row.plate}</td>
                  <td className="py-2 text-right">{row.count}</td>
                  <td className="py-2 text-right">{row.km}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="bg-white rounded-xl border border-slate-200/80 p-4 overflow-x-auto">
          <h2 className="text-sm font-semibold text-[#0A2B4E] mb-3">Avize pe săptămână</h2>
          <table className="w-full text-sm min-w-[280px]">
            <thead>
              <tr className="text-xs text-slate-500 border-b">
                <th className="text-left py-2">Săptămână</th>
                <th className="text-right py-2">Total</th>
                <th className="text-right py-2">Confirmate</th>
              </tr>
            </thead>
            <tbody>
              {(reportData.weekly || []).length === 0 ? (
                <tr><td colSpan={3} className="py-3 text-slate-400 text-sm">Nicio săptămână în interval.</td></tr>
              ) : (reportData.weekly || []).map((row) => (
                <tr key={row.week_start} className="border-b border-slate-50">
                  <td className="py-2">{String(row.week_start).slice(0, 10)}</td>
                  <td className="py-2 text-right">{row.count}</td>
                  <td className="py-2 text-right">{row.confirmed}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      <div className="bg-white rounded-xl border border-slate-200/80 p-4 overflow-x-auto">
        <div className="flex flex-wrap items-center gap-2 mb-3">
          <h2 className="text-sm font-semibold text-[#0A2B4E]">Istoric export</h2>
          <button
            type="button"
            disabled={exports.length === 0 || deleting}
            onClick={() => setPendingDelete({ type: 'all' })}
            className="ml-auto text-xs px-2 py-1 rounded border border-red-200 text-red-700 hover:bg-red-50 disabled:opacity-40 inline-flex items-center gap-1"
          >
            {deleting && pendingDelete?.type === 'all'
              ? <Loader2 className="w-3 h-3 animate-spin" />
              : <Trash2 className="w-3 h-3" />}
            Șterge tot istoricul
          </button>
        </div>
        <table className="w-full text-sm min-w-[480px]">
          <thead>
            <tr className="text-xs text-slate-500 border-b">
              <th className="text-left py-2">Când</th>
              <th className="text-left py-2">Cine</th>
              <th className="text-left py-2">Tip</th>
              <th className="text-left py-2">Fișier</th>
              <th className="text-right py-2">Avize</th>
              <th className="text-right py-2 w-20"> </th>
            </tr>
          </thead>
          <tbody>
            {exports.length === 0 ? (
              <tr><td colSpan={6} className="py-3 text-slate-400 text-sm">Niciun export încă.</td></tr>
            ) : exports.map((row) => (
              <tr key={row.id} className="border-b border-slate-50">
                <td className="py-2">{String(row.created_at || '').slice(0, 16).replace('T', ' ')}</td>
                <td className="py-2 truncate" title={row.user_email || ''}>{exportWho(row)}</td>
                <td className="py-2">{row.kind}</td>
                <td className="py-2 truncate">{row.filename || '—'}</td>
                <td className="py-2 text-right">{row.aviz_count ?? '—'}</td>
                <td className="py-2 text-right">
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
