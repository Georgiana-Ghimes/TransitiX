import React, { useEffect, useState } from 'react';
import { api } from '@/api/client';
import KpiCard from '@/components/KpiCard';
import InvoiceForm from '@/components/InvoiceForm';
import SuggestSearch from '@/components/SuggestSearch';
import { Plus, FileText, Euro, Wallet, TrendingUp, Download } from 'lucide-react';

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
    try {
      await api.integrations.Core.SendEmail({
        to: 'client@exemplu.ro',
        subject: `Factura ${inv.series} ${inv.number} - Transitix`,
        body: `Factura ${inv.series} ${inv.number} în valoare de ${inv.total_amount} ${inv.currency} a fost emisă.\n\nClient: ${inv.client_name}\nScadență: ${inv.due_date}\n\nMultumim!`,
      });
      await api.entities.Invoice.update(inv.id, { status: 'sent' });
      loadData();
    } catch (e) { alert('Eroare: ' + (e.message || '')); }
  };

  const sendToEfactura = async (inv) => {
    await api.entities.Invoice.update(inv.id, { efactura_status: 'sent' });
    alert(`Factura ${inv.series} ${inv.number} a fost transmisă către e-Factura ANAF (simulare).`);
    loadData();
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
          <p className="text-sm text-slate-500 mt-1">Facturare, încasări și integrare e-Factura ANAF</p>
        </div>
        <div className="flex gap-2">
          <button onClick={exportCSV} className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-slate-600 bg-white border border-slate-200 rounded-lg hover:bg-slate-50 transition-colors"><Download className="w-4 h-4" /> Export</button>
          <button onClick={() => { setEditInvoice(null); setShowForm(true); }} className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-[#0A2B4E] rounded-lg hover:bg-[#1D4E89] transition-colors"><Plus className="w-4 h-4" /> Factură nouă</button>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <KpiCard icon={FileText} label="Facturi emise" value={invoices.length} subtitle={`${totalIssued.toLocaleString('ro-RO')} RON`} accent="primary" />
        <KpiCard icon={Euro} label="Încasat" value={totalPaid.toLocaleString('ro-RO')} subtitle="RON · luna curentă" accent="success" />
        <KpiCard icon={Wallet} label="Neplătite" value={unpaid} subtitle="Facturi restante" accent="danger" />
        <KpiCard icon={TrendingUp} label="e-Factura" value={invoices.filter(i => i.efactura_status === 'sent' || i.efactura_status === 'accepted').length} subtitle="Trimise ANAF" accent="accent" />
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
              {inv.status === 'draft' && <button onClick={() => sendToClient(inv)} className="text-blue-600 hover:underline text-xs">Trimite</button>}
              {inv.status === 'sent' && <button onClick={() => markPaid(inv)} className="text-emerald-600 hover:underline text-xs">Plătită</button>}
              {inv.efactura_status === 'not_sent' && <button onClick={() => sendToEfactura(inv)} className="text-[#F5A623] hover:underline text-xs">e-Factura</button>}
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
                  <tr key={inv.id} className="border-b border-slate-50 hover:bg-slate-50/50">
                    <td className="px-4 py-3 font-medium text-[#0A2B4E]">{inv.series} {inv.number}</td>
                    <td className="px-4 py-3 text-slate-600">{inv.client_name}</td>
                    <td className="px-4 py-3 text-slate-500">{inv.issue_date ? new Date(inv.issue_date).toLocaleDateString('ro-RO') : '-'}</td>
                    <td className="px-4 py-3 text-slate-500">{inv.due_date ? new Date(inv.due_date).toLocaleDateString('ro-RO') : '-'}</td>
                    <td className="px-4 py-3 text-right font-medium text-slate-700">{inv.total_amount?.toLocaleString('ro-RO')} {inv.currency}</td>
                    <td className="px-4 py-3"><InvoiceStatusBadge status={inv.status} /></td>
                    <td className="px-4 py-3">
                      {inv.efactura_status === 'sent' ? <span className="text-xs text-blue-600">Trimisă</span> :
                       inv.efactura_status === 'accepted' ? <span className="text-xs text-emerald-600">Acceptată</span> :
                       inv.efactura_status === 'rejected' ? <span className="text-xs text-red-600">Respinsă</span> :
                       <span className="text-xs text-slate-400">Netrimisă</span>}
                    </td>
                    <td className="px-4 py-3 text-right space-x-2">
                      <button onClick={() => { setEditInvoice(inv); setShowForm(true); }} className="text-[#1D4E89] hover:underline text-xs">Editează</button>
                      {inv.status === 'draft' && <button onClick={() => sendToClient(inv)} className="text-blue-600 hover:underline text-xs">Trimite</button>}
                      {inv.status === 'sent' && <button onClick={() => markPaid(inv)} className="text-emerald-600 hover:underline text-xs">Plătită</button>}
                      {inv.efactura_status === 'not_sent' && <button onClick={() => sendToEfactura(inv)} className="text-[#F5A623] hover:underline text-xs">e-Factura</button>}
                    </td>
                  </tr>
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