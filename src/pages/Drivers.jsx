import React, { useEffect, useState } from 'react';
import { api } from '@/api/client';
import StatusBadge from '@/components/StatusBadge';
import DriverForm from '@/components/DriverForm';
import { Plus, Search, Users, Phone, Mail } from 'lucide-react';

export default function Drivers() {
  const [drivers, setDrivers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editDriver, setEditDriver] = useState(null);
  const [search, setSearch] = useState('');

  useEffect(() => { loadDrivers(); }, []);

  const loadDrivers = async () => {
    try { setDrivers(await api.entities.Driver.list()); }
    catch (e) { console.error(e); }
    finally { setLoading(false); }
  };

  const handleDelete = async (id) => {
    if (!confirm('Dezactivați acest șofer?')) return;
    await api.entities.Driver.update(id, { is_active: false, status: 'indisponibil' });
    loadDrivers();
  };

  const filtered = drivers.filter(d =>
    !search || d.name?.toLowerCase().includes(search.toLowerCase()) ||
    d.phone?.toLowerCase().includes(search.toLowerCase()) ||
    d.email?.toLowerCase().includes(search.toLowerCase())
  );

  if (loading) return <div className="flex items-center justify-center h-96"><div className="w-8 h-8 border-4 border-slate-200 border-t-[#0A2B4E] rounded-full animate-spin" /></div>;

  return (
    <div className="space-y-5 max-w-7xl mx-auto">
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-2xl font-bold text-[#0A2B4E] tracking-tight">Șoferi</h1>
          <p className="text-sm text-slate-500 mt-1">{filtered.length} șoferi</p>
        </div>
        <button onClick={() => { setEditDriver(null); setShowForm(true); }} className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-[#0A2B4E] rounded-lg hover:bg-[#1D4E89] transition-colors">
          <Plus className="w-4 h-4" /> Șofer nou
        </button>
      </div>

      <div className="relative max-w-md">
        <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
        <input type="text" value={search} onChange={e => setSearch(e.target.value)} placeholder="Caută după nume, telefon, email..." className="w-full pl-9 pr-4 py-2 text-sm bg-white border border-slate-200 rounded-lg focus:outline-none focus:border-[#1D4E89] transition-colors" />
      </div>

      {filtered.length > 0 ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filtered.map(d => (
            <div key={d.id} className="bg-white rounded-xl border border-slate-200/80 p-5 shadow-sm hover:shadow-md transition-shadow">
              <div className="flex items-start justify-between mb-3">
                <div className="flex items-center gap-3">
                  <div className="w-11 h-11 rounded-full bg-gradient-to-br from-[#1D4E89] to-[#0A2B4E] flex items-center justify-center text-white font-semibold">
                    {d.name?.charAt(0)?.toUpperCase() || '?'}
                  </div>
                  <div>
                    <p className="font-semibold text-[#0A2B4E]">{d.name}</p>
                    <p className="text-xs text-slate-500">{d.license_category ? `Cat. ${d.license_category}` : 'Fără categorie'}</p>
                  </div>
                </div>
                <StatusBadge status={d.status} type="driver" />
              </div>
              <div className="space-y-1.5 text-sm text-slate-600">
                {d.phone && <p className="flex items-center gap-2"><Phone className="w-3.5 h-3.5 text-slate-400" /> {d.phone}</p>}
                {d.email && <p className="flex items-center gap-2 truncate"><Mail className="w-3.5 h-3.5 text-slate-400" /> {d.email}</p>}
              </div>
              <div className="grid grid-cols-2 gap-2 mt-3 text-xs">
                <div className="bg-slate-50 rounded-lg p-2"><p className="text-slate-400">Permis exp.</p><p className={`font-medium ${d.license_expiry && new Date(d.license_expiry) < new Date() ? 'text-red-600' : 'text-slate-700'}`}>{d.license_expiry ? new Date(d.license_expiry).toLocaleDateString('ro-RO') : '-'}</p></div>
                <div className="bg-slate-50 rounded-lg p-2"><p className="text-slate-400">Medical exp.</p><p className={`font-medium ${d.medical_certificate_expiry && new Date(d.medical_certificate_expiry) < new Date() ? 'text-red-600' : 'text-slate-700'}`}>{d.medical_certificate_expiry ? new Date(d.medical_certificate_expiry).toLocaleDateString('ro-RO') : '-'}</p></div>
              </div>
              <div className="flex gap-2 mt-3 pt-3 border-t border-slate-100">
                <button onClick={() => { setEditDriver(d); setShowForm(true); }} className="flex-1 text-xs font-medium text-[#1D4E89] bg-blue-50 rounded-lg py-1.5 hover:bg-blue-100">Editează</button>
                <button onClick={() => handleDelete(d.id)} className="flex-1 text-xs font-medium text-red-500 bg-red-50 rounded-lg py-1.5 hover:bg-red-100">Dezactivează</button>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-slate-200/80 p-12 text-center text-slate-400 shadow-sm">
          <Users className="w-10 h-10 mx-auto mb-3 opacity-40" />
          <p className="text-sm">Nu există șoferi. Adaugă primul șofer.</p>
        </div>
      )}

      {showForm && <DriverForm driver={editDriver} onClose={() => setShowForm(false)} onSave={() => { setShowForm(false); loadDrivers(); }} />}
    </div>
  );
}