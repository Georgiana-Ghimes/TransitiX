import React, { useEffect, useState } from 'react';
import { api } from '@/api/client';
import ClientForm from '@/components/ClientForm';
import { Plus, Search, Building2, Phone, Mail, MapPin } from 'lucide-react';

export default function Clients() {
  const [clients, setClients] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editClient, setEditClient] = useState(null);
  const [search, setSearch] = useState('');

  useEffect(() => { loadClients(); }, []);

  const loadClients = async () => {
    try { setClients(await api.entities.Client.list()); }
    catch (e) { console.error(e); }
    finally { setLoading(false); }
  };

  const handleDelete = async (id) => {
    if (!confirm('Dezactivați acest client?')) return;
    await api.entities.Client.update(id, { is_active: false });
    loadClients();
  };

  const filtered = clients.filter(c =>
    !search || c.name?.toLowerCase().includes(search.toLowerCase()) ||
    c.cui?.toLowerCase().includes(search.toLowerCase()) ||
    c.contact_person?.toLowerCase().includes(search.toLowerCase())
  );

  if (loading) return <div className="flex items-center justify-center h-96"><div className="w-8 h-8 border-4 border-slate-200 border-t-[#0A2B4E] rounded-full animate-spin" /></div>;

  return (
    <div className="space-y-5 max-w-7xl mx-auto">
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-2xl font-bold text-[#0A2B4E] tracking-tight">Clienți</h1>
          <p className="text-sm text-slate-500 mt-1">{filtered.length} clienți</p>
        </div>
        <button onClick={() => { setEditClient(null); setShowForm(true); }} className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-[#0A2B4E] rounded-lg hover:bg-[#1D4E89] transition-colors">
          <Plus className="w-4 h-4" /> Client nou
        </button>
      </div>

      <div className="relative max-w-md">
        <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
        <input type="text" value={search} onChange={e => setSearch(e.target.value)} placeholder="Caută după denumire, CUI, contact..." className="w-full pl-9 pr-4 py-2 text-sm bg-white border border-slate-200 rounded-lg focus:outline-none focus:border-[#1D4E89] transition-colors" />
      </div>

      {filtered.length > 0 ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filtered.map(c => (
            <div key={c.id} className="bg-white rounded-xl border border-slate-200/80 p-5 shadow-sm hover:shadow-md transition-shadow">
              <div className="flex items-start gap-3 mb-3">
                <div className="w-11 h-11 rounded-lg bg-[#1D4E89] flex items-center justify-center">
                  <Building2 className="w-5 h-5 text-white" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-semibold text-[#0A2B4E] truncate">{c.name}</p>
                  <p className="text-xs text-slate-500">CUI: {c.cui || '-'}</p>
                </div>
              </div>
              <div className="space-y-1.5 text-sm text-slate-600">
                {c.contact_person && <p className="text-xs text-slate-500">Contact: {c.contact_person}</p>}
                {c.address && <p className="flex items-center gap-2 text-xs truncate"><MapPin className="w-3.5 h-3.5 text-slate-400 shrink-0" /> {c.address}</p>}
                {c.phone && <p className="flex items-center gap-2 text-xs"><Phone className="w-3.5 h-3.5 text-slate-400" /> {c.phone}</p>}
                {c.email && <p className="flex items-center gap-2 text-xs truncate"><Mail className="w-3.5 h-3.5 text-slate-400" /> {c.email}</p>}
              </div>
              <div className="flex gap-2 mt-3 pt-3 border-t border-slate-100">
                <button onClick={() => { setEditClient(c); setShowForm(true); }} className="flex-1 text-xs font-medium text-[#1D4E89] bg-blue-50 rounded-lg py-1.5 hover:bg-blue-100">Editează</button>
                <button onClick={() => handleDelete(c.id)} className="flex-1 text-xs font-medium text-red-500 bg-red-50 rounded-lg py-1.5 hover:bg-red-100">Dezactivează</button>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-slate-200/80 p-12 text-center text-slate-400 shadow-sm">
          <Building2 className="w-10 h-10 mx-auto mb-3 opacity-40" />
          <p className="text-sm">Nu există clienți. Adaugă primul client.</p>
        </div>
      )}

      {showForm && <ClientForm client={editClient} onClose={() => setShowForm(false)} onSave={() => { setShowForm(false); loadClients(); }} />}
    </div>
  );
}