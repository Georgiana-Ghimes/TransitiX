import React from 'react';

function exportWho(row) {
  return row.user_name || row.user_email || '—';
}

export default function AvizReportsTab({ filterBar, reportData }) {
  return (
    <div className="space-y-4">
      {filterBar}
      <p className="text-xs text-slate-500">
        Rapoartele nu modifică șablonul Anexa Factura RAI. Unește rămâne pe tab-ul Avize.
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
        <h2 className="text-sm font-semibold text-[#0A2B4E] mb-3">Istoric export</h2>
        <table className="w-full text-sm min-w-[420px]">
          <thead>
            <tr className="text-xs text-slate-500 border-b">
              <th className="text-left py-2">Când</th>
              <th className="text-left py-2">Cine</th>
              <th className="text-left py-2">Tip</th>
              <th className="text-left py-2">Fișier</th>
              <th className="text-right py-2">Avize</th>
            </tr>
          </thead>
          <tbody>
            {(reportData.exports || []).length === 0 ? (
              <tr><td colSpan={5} className="py-3 text-slate-400 text-sm">Niciun export încă.</td></tr>
            ) : (reportData.exports || []).map((row) => (
              <tr key={row.id} className="border-b border-slate-50">
                <td className="py-2">{String(row.created_at || '').slice(0, 16).replace('T', ' ')}</td>
                <td className="py-2 truncate" title={row.user_email || ''}>{exportWho(row)}</td>
                <td className="py-2">{row.kind}</td>
                <td className="py-2 truncate">{row.filename || '—'}</td>
                <td className="py-2 text-right">{row.aviz_count ?? '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
