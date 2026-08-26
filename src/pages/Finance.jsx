import React, { useEffect, useState } from 'react';
import { api } from '@/api/client';
import KpiCard from '@/components/KpiCard';
import InvoiceForm from '@/components/InvoiceForm';
import SuggestSearch from '@/components/SuggestSearch';
import { notifyError, notifySuccess } from '@/lib/notify';
import { Plus, FileText, Euro, Wallet, TrendingUp, Download } from 'lucide-react';
import DemoBanner from '@/components/DemoBanner';

const INVOICE_STATUS = {
  draft: { label: 'Ciornă', className: 'bg-slate-100 text-slate-600 border-slate-200' },
  sent: { label: 'Trimisă', className: 'bg-blue-50 text-blue-700 border-blue-200' },
  paid: { label: 'Plătită', className: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
  overdue: { label: 'Restantă', className: 'bg-red-50 text-red-700 border-red-200' },
  cancelled: { label: 'Anulată', className: 'bg-zinc-100 text-zinc-500 border-zinc-200' },
};

function InvoiceStatusBadge({ status }) {
  const s = INVOICE_STATUS[status] || INVOICE_STATUS.draft;
  return <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium border ${s.className}`}>{s.label}</span>;
}


/** The charges behind one invoice, in the order the engine produced them. */
function InvoiceLines({ lines }) {
  if (!lines) return <p className="text-xs text-slate-400">Se încarcă…</p>;
  if (lines.length === 0) {
    return (
      <p className="text-xs text-slate-500">
        Factura nu are linii — a fost creată manual, nu din TPO-urile curselor.
      </p>
    );
  }
  return (
    <table className="w-full text-xs">
      <thead>
        <tr className="text-slate-400">
          <th className="text-left font-medium py-1">Referință</th>
          <th className="text-left font-medium py-1">Componentă</th>
          <th className="text-right font-medium py-1">Cantitate</th>
          <th className="text-right font-medium py-1">Preț unitar</th>
          <th className="text-right font-medium py-1">Valoare</th>
        </tr>
      </thead>
      <tbody>
        {lines.map((line) => (
          <tr key={line.id} className="border-t border-slate-200/60">
            <td className="py-1 text-slate-500">{line.reference || '—'}</td>
            <td className="py-1 text-slate-700">
              {line.code ? <span className="font-mono text-[10px] text-slate-400 mr-1">{line.code}</span> : null}
              {line.label}
            </td>
            <td className="py-1 text-right tabular-nums text-slate-500">
              {line.quantity == null ? '—' : Number(line.quantity).toLocaleString('ro-RO')}
            </td>
            <td className="py-1 text-right tabular-nums text-slate-500">
              {line.unit_amount == null ? '—' : Number(line.unit_amount).toLocaleString('ro-RO', { minimumFractionDigits: 2 })}
            </td>
            <td className="py-1 text-right tabular-nums font-medium text-slate-700">
              {Number(line.amount).toLocaleString('ro-RO', { minimumFractionDigits: 2 })} {line.currency}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export default function Finance() {
  const [invoices, setInvoices] = useState([]);
  const [trips, setTrips] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editInvoice, setEditInvoice] = useState(null);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');

  useEffect(() => { loadData(); }, []);

  const loadData = async () => {
    try {
      const [inv, t] = await Promise.all([
        api.entities.Invoice.list('-created_date'),
        api.entities.Trip.list('-created_date', 50),
      ]);
      setInvoices(inv);
      setTrips(t);
    } catch (e) { console.error(e); }
    finally { setLoading(false); }
  };

  const handleSave = async () => { setShowForm(false); setEditInvoice(null); await loadData(); };

  const markPaid = async (inv) => {
    await api.entities.Invoice.update(inv.id, { status: 'paid', payment_date: new Date().toISOString().split('T')[0] });
    loadData();
  };

  const sendToClient = async (inv) => {
    const trip = inv.trip_id ? trips.find((t) => t.id === inv.trip_id) : null;
    const to = trip?.consignee_email || trip?.shipper_email || '';
    if (!to) {
      notifyError('Email lipsă', 'Adaugă email pe cursă. Nu trimitem către adrese fictive.');
      return;
    }
    try {
      await api.integrations.Core.SendEmail({
        to,
        subject: `Factura ${inv.series} ${inv.number} - Transitix`,
        body: `Factura ${inv.series} ${inv.number} în valoare de ${inv.total_amount} ${inv.currency} a fost emisă.\n\nClient: ${inv.client_name}\nScadență: ${inv.due_date}\n\nMultumim!`,
      });
      await api.entities.Invoice.update(inv.id, { status: 'sent' });
      notifySuccess('Factură marcată trimisă', `${inv.series} ${inv.number} către ${to}. Dacă Resend nu e configurat, mesajul e doar în logul API.`);
      loadData();
    } catch (e) {
      notifyError('Trimitere eșuată', e);
    }
  };

  const sendToEfactura = () => {
    notifyError(
      'e-Factura SPV nu e conectată',
      'Folosește „Descarcă UBL” pentru XML local. Nu marcăm factura ca trimisă către ANAF fără certificat SPV.'
    );
  };

  const downloadUbl = async (inv) => {
    try {
      const { blob, filename } = await api.invoices.downloadUbl(inv.id);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      a.click();
      URL.revokeObjectURL(url);
      notifySuccess('UBL descărcat', `${filename} — local, nu e trimis la SPV`);
    } catch (e) {
      notifyError('Export UBL eșuat', e);
    }
  };

  const [openLines, setOpenLines] = useState(null);
  const [lines, setLines] = useState({});

  /**
   * Loads the components behind an invoice, once.
   *
   * A customer disputes a component — "why 120 for the crane" — not a total. The invoice is built
   * from `trip_charges`, so the breakdown exists; without a way to open it, it would exist only
   * in the database.
   */
  const toggleLines = async (id) => {
    if (openLines === id) { setOpenLines(null); return; }
    setOpenLines(id);
    if (lines[id]) return;
    try {
      const res = await api.invoices.lines(id);
      setLines((prev) => ({ ...prev, [id]: res.lines }));
    } catch {
      setLines((prev) => ({ ...prev, [id]: [] }));
    }
  };

  const exportCSV = () => {
    const headers = ['Serie', 'Număr', 'Client', 'Data emiterii', 'Scadență', 'Total', 'Status'];
    const rows = invoices.map(i => [i.series, i.number, i.client_name, i.issue_date, i.due_date, i.total_amount, i.status]);
    const csv = [headers, ...rows].map(r => r.map(c => `"${c ?? ''}"`).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = 'facturi.csv'; a.click();
    URL.revokeObjectURL(url);
  };

  if (loading) return <div className="flex items-center justify-center h-96"><div className="w-8 h-8 border-4 border-slate-200 border-t-[#0A2B4E] rounded-full animate-spin" /></div>;

  const totalIssued = invoices.reduce((s, i) => s + (i.total_amount || 0), 0);
  const totalPaid = invoices.filter(i => i.status === 'paid').reduce((s, i) => s + (i.total_amount || 0), 0);
  const unpaid = invoices.filter(i => i.status === 'sent' || i.status === 'overdue').length;

  const filtered = invoices.filter(i =>
    (statusFilter === 'all' || i.status === statusFilter) &&
    (!search || i.number?.toLowerCase().includes(search.toLowerCase()) || i.client_name?.toLowerCase().includes(search.toLowerCase()))
  );

  return (
    <div className="space-y-5 max-w-7xl mx-auto">
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-2xl font-bold text-[#0A2B4E] tracking-tight">Financiar</h1>
          <p className="text-sm text-slate-500 mt-1">Facturi locale, UBL pentru e-Factura, încasări — fără SPV ANAF</p>
        </div>
        <div className="flex gap-2">
          <button onClick={exportCSV} className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-slate-600 bg-white border border-slate-200 rounded-lg hover:bg-slate-50 transition-colors"><Download className="w-4 h-4" /> Export</button>
          <button onClick={() => { setEditInvoice(null); setShowForm(true); }} className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-[#0A2B4E] rounded-lg hover:bg-[#1D4E89] transition-colors"><Plus className="w-4 h-4" /> Factură nouă</button>
        </div>
      </div>

      <DemoBanner title="e-Factura: UBL local, SPV neconectat">
        Poți descărca XML UBL (CIUS-RO) pentru fiecare factură. Trimiterea către SPV ANAF vine după
        certificat — până atunci statusul e-Factura rămâne local și nu inventăm „acceptat”.
      </DemoBanner>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <KpiCard icon={FileText} label="Facturi emise" value={invoices.length} subtitle={`${totalIssued.toLocaleString('ro-RO')} RON`} accent="primary" />
        <KpiCard icon={Euro} label="Încasat" value={totalPaid.toLocaleString('ro-RO')} subtitle="RON · luna curentă" accent="success" />
        <KpiCard icon={Wallet} label="Neplătite" value={unpaid} subtitle="Facturi restante" accent="danger" />
        <KpiCard icon={TrendingUp} label="e-Factura" value="UBL" subtitle="Export local · SPV off" accent="accent" />
      </div>

      {/* Filters */}
      <div className="flex items-center gap-3 flex-wrap">
        <SuggestSearch
          className="w-full min-w-0 sm:flex-1 sm:min-w-[240px] max-w-md"
          value={search}
          onChange={setSearch}
          items={invoices}
          placeholder="Caută factură..."
          getItem={(i) => ({
            id: i.id,
            title: [i.series, i.number].filter(Boolean).join(' ') || 'Factură',
            subtitle: [i.client_name, i.total_amount != null ? `${i.total_amount} ${i.currency || 'RON'}` : null].filter(Boolean).join(' · '),
            filterValue: i.number || i.client_name || '',
            searchText: [i.series, i.number, i.client_name].join(' '),
          })}
        />
        <div className="flex gap-1.5 flex-wrap w-full sm:w-auto">
          {['all', 'draft', 'sent', 'paid', 'overdue'].map(f => (
            <button key={f} onClick={() => setStatusFilter(f)} className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-colors ${statusFilter === f ? 'bg-[#0A2B4E] text-white' : 'bg-white text-slate-600 border border-slate-200 hover:bg-slate-50'}`}>
              {f === 'all' ? 'Toate' : INVOICE_STATUS[f].label}
            </button>
          ))}
        </div>
      </div>

      {/* Mobile cards */}
      <div className="md:hidden space-y-3">
        {filtered.length > 0 ? filtered.map((inv) => (
          <div key={inv.id} className="bg-white rounded-xl border border-slate-200/80 shadow-sm p-4">
            <div className="flex items-start justify-between gap-3 mb-2">
              <div className="min-w-0">
                <p className="font-semibold text-[#0A2B4E] truncate">{inv.series} {inv.number}</p>
                <p className="text-sm text-slate-600 truncate">{inv.client_name}</p>
              </div>
              <InvoiceStatusBadge status={inv.status} />
            </div>
            <p className="text-sm font-medium text-slate-700">
              {inv.total_amount?.toLocaleString('ro-RO')} {inv.currency}
            </p>
            <p className="text-xs text-slate-500 mt-1">
              Emitere {inv.issue_date ? new Date(inv.issue_date).toLocaleDateString('ro-RO') : '-'}
              {inv.due_date ? ` · Scadență ${new Date(inv.due_date).toLocaleDateString('ro-RO')}` : ''}
            </p>
            <div className="flex flex-wrap gap-3 mt-3 pt-3 border-t border-slate-100">
              <button onClick={() => { setEditInvoice(inv); setShowForm(true); }} className="text-[#1D4E89] hover:underline text-xs">Editează</button>
              <button onClick={() => downloadUbl(inv)} className="text-slate-600 hover:underline text-xs">Descarcă UBL</button>
              {inv.status === 'draft' && <button onClick={() => sendToClient(inv)} className="text-blue-600 hover:underline text-xs">Trimite</button>}
              {inv.status === 'sent' && <button onClick={() => markPaid(inv)} className="text-emerald-600 hover:underline text-xs">Plătită</button>}
              {inv.efactura_status === 'not_sent' && <button onClick={() => sendToEfactura(inv)} className="text-[#F5A623] hover:underline text-xs">e-Factura SPV</button>}
            </div>
          </div>
        )) : (
          <div className="bg-white rounded-xl border border-slate-200/80 p-10 text-center text-slate-400 shadow-sm">
            <FileText className="w-10 h-10 mx-auto mb-3 opacity-40" />
            <p className="text-sm">Nu există facturi. Creează prima factură.</p>
          </div>
        )}
      </div>

      {/* Desktop table */}
      <div className="hidden md:block bg-white rounded-xl border border-slate-200/80 shadow-sm overflow-hidden">
        {filtered.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[800px]">
              <thead>
                <tr className="border-b border-slate-100 text-slate-500 text-xs">
                  <th className="text-left font-medium px-4 py-3">Factură</th>
                  <th className="text-left font-medium px-4 py-3">Client</th>
                  <th className="text-left font-medium px-4 py-3">Emitere</th>
                  <th className="text-left font-medium px-4 py-3">Scadență</th>
                  <th className="text-right font-medium px-4 py-3">Total</th>
                  <th className="text-left font-medium px-4 py-3">Status</th>
                  <th className="text-left font-medium px-4 py-3">e-Factura</th>
                  <th className="text-right font-medium px-4 py-3">Acțiuni</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map(inv => (
                  <React.Fragment key={inv.id}>
                  <tr className="border-b border-slate-50 hover:bg-slate-50/50">
                    <td className="px-4 py-3 font-medium text-[#0A2B4E]">
                      <button
                        type="button"
                        onClick={() => toggleLines(inv.id)}
                        className="hover:underline"
                        title="Vezi componentele facturii"
                      >
                        {inv.series} {inv.number}
                      </button>
                    </td>
                    <td className="px-4 py-3 text-slate-600">{inv.client_name}</td>
                    <td className="px-4 py-3 text-slate-500">{inv.issue_date ? new Date(inv.issue_date).toLocaleDateString('ro-RO') : '-'}</td>
                    <td className="px-4 py-3 text-slate-500">{inv.due_date ? new Date(inv.due_date).toLocaleDateString('ro-RO') : '-'}</td>
                    <td className="px-4 py-3 text-right font-medium text-slate-700">{inv.total_amount?.toLocaleString('ro-RO')} {inv.currency}</td>
                    <td className="px-4 py-3"><InvoiceStatusBadge status={inv.status} /></td>
                    <td className="px-4 py-3">
                      {inv.efactura_status === 'sent' ? <span className="text-xs text-blue-600">Trimisă</span> :
                       inv.efactura_status === 'accepted' ? <span className="text-xs text-emerald-600">Acceptată</span> :
                       inv.efactura_status === 'rejected' ? <span className="text-xs text-red-600">Respinsă</span> :
                       <span className="text-xs text-slate-400">UBL local</span>}
                    </td>
                    <td className="px-4 py-3 text-right space-x-2">
                      <button onClick={() => { setEditInvoice(inv); setShowForm(true); }} className="text-[#1D4E89] hover:underline text-xs">Editează</button>
                      <button onClick={() => downloadUbl(inv)} className="text-slate-600 hover:underline text-xs">UBL</button>
                      {inv.status === 'draft' && <button onClick={() => sendToClient(inv)} className="text-blue-600 hover:underline text-xs">Trimite</button>}
                      {inv.status === 'sent' && <button onClick={() => markPaid(inv)} className="text-emerald-600 hover:underline text-xs">Plătită</button>}
                      {inv.efactura_status === 'not_sent' && <button onClick={() => sendToEfactura(inv)} className="text-[#F5A623] hover:underline text-xs">SPV</button>}
                    </td>
                  </tr>
                  {openLines === inv.id ? (
                    <tr className="bg-slate-50/60">
                      <td colSpan={8} className="px-4 py-3">
                        <InvoiceLines lines={lines[inv.id]} />
                      </td>
                    </tr>
                  ) : null}
                  </React.Fragment>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="p-12 text-center text-slate-400"><FileText className="w-10 h-10 mx-auto mb-3 opacity-40" /><p className="text-sm">Nu există facturi. Creează prima factură.</p></div>
        )}
      </div>

      {showForm && <InvoiceForm invoice={editInvoice} trips={trips} onClose={() => setShowForm(false)} onSave={handleSave} />}
    </div>
  );
}