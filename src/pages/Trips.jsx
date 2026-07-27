import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { base44 } from '@/api/base44Client';
import StatusBadge from '@/components/StatusBadge';
import TripForm from '@/components/TripForm';
import { Plus, Search, Download, Route } from 'lucide-react';

const STATUS_FILTERS = [
  { value: 'all', label: 'Toate' },
  { value: 'planificata', label: 'De planificat' },
  { value: 'alocata', label: 'Alocate' },
  { value: 'incarcata', label: 'Încărcate' },
  { value: 'in_tranzit', label: 'În tranzit' },
  { value: 'livrata', label: 'Livrate' },
  { value: 'problema', label: 'Problemă' },
  { value: 'anulata', label: 'Anulate' },
];

export default function Trips() {
  const [trips, setTrips] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editTrip, setEditTrip] = useState(null);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');

  useEffect(() => { loadTrips(); }, []);

  const loadTrips = async () => {
    try {
      const data = await base44.entities.Trip.list('-created_date', 200);
      setTrips(data);
    } catch (e) { console.error(e); }
    finally { setLoading(false); }
  };

  const handleSave = async () => {
    setShowForm(false);
    setEditTrip(null);
    await loadTrips();
  };

  const handleDelete = async (id) => {
    if (!confirm('Sigur doriți să ștergeți această cursă?')) return;
    await base44.entities.Trip.delete(id);
    loadTrips();
  };

  const filtered = trips.filter(t => {
    const matchesSearch = !search ||
      t.cmr_number?.toLowerCase().includes(search.toLowerCase()) ||
      t.driver_name?.toLowerCase().includes(search.toLowerCase()) ||
      t.vehicle_plate?.toLowerCase().includes(search.toLowerCase()) ||
      t.shipper_name?.toLowerCase().includes(search.toLowerCase()) ||
      t.consignee_name?.toLowerCase().includes(search.toLowerCase());
    const matchesStatus = statusFilter === 'all' || t.status === statusFilter;
    return matchesSearch && matchesStatus;
  });

  const exportCSV = () => {
    const headers = ['CMR', 'Șofer', 'Vehicul', 'Expeditor', 'Destinatar', 'Status', 'Data încărcării', 'Greutate', 'Colete'];
    const rows = filtered.map(t => [t.cmr_number, t.driver_name, t.vehicle_plate, t.shipper_name, t.consignee_name, t.status, t.loading_date, t.weight_kg, t.package_count]);
    const csv = [headers, ...rows].map(r => r.map(c => `"${c ?? ''}"`).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = 'curse.csv'; a.click();
    URL.revokeObjectURL(url);
  };

  if (loading) {
    return <div className="flex items-center justify-center h-96"><div className="w-8 h-8 border-4 border-slate-200 border-t-[#0A2B4E] rounded-full animate-spin" /></div>;
  }

  return (
    <div className="space-y-5 max-w-7xl mx-auto">
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-2xl font-bold text-[#0A2B4E] tracking-tight">Curse</h1>
          <p className="text-sm text-slate-500 mt-1">{filtered.length} curse · gestionare transporturi</p>
        </div>
        <div className="flex gap-2">
          <button onClick={exportCSV} className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-slate-600 bg-white border border-slate-200 rounded-lg hover:bg-slate-50 transition-colors">
            <Download className="w-4 h-4" /> Export
          </button>
          <button onClick={() => { setEditTrip(null); setShowForm(true); }} className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-[#0A2B4E] rounded-lg hover:bg-[#1D4E89] transition-colors">
            <Plus className="w-4 h-4" /> Cursă nouă
          </button>
        </div>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="relative flex-1 min-w-[240px] max-w-md">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            type="text" value={search} onChange={e => setSearch(e.target.value)}
            placeholder="Caută după CMR, șofer, vehicul, expeditor..."
            className="w-full pl-9 pr-4 py-2 text-sm bg-white border border-slate-200 rounded-lg focus:outline-none focus:border-[#1D4E89] transition-colors"
          />
        </div>
        <div className="flex gap-1.5 flex-wrap">
          {STATUS_FILTERS.map(f => (
            <button
              key={f.value}
              onClick={() => setStatusFilter(f.value)}
              className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-colors ${statusFilter === f.value ? 'bg-[#0A2B4E] text-white' : 'bg-white text-slate-600 border border-slate-200 hover:bg-slate-50'}`}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      {/* Table */}
      <div className="bg-white rounded-xl border border-slate-200/80 shadow-sm overflow-hidden">
        {filtered.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-100 text-slate-500 text-xs">
                  <th className="text-left font-medium px-4 py-3">CMR</th>
                  <th className="text-left font-medium px-4 py-3">Șofer</th>
                  <th className="text-left font-medium px-4 py-3">Vehicul</th>
                  <th className="text-left font-medium px-4 py-3">Expeditor → Destinatar</th>
                  <th className="text-left font-medium px-4 py-3">Încărcare</th>
                  <th className="text-left font-medium px-4 py-3">Status</th>
                  <th className="text-right font-medium px-4 py-3">Acțiuni</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map(trip => (
                  <tr key={trip.id} className="border-b border-slate-50 hover:bg-slate-50/50">
                    <td className="px-4 py-3 font-medium text-[#0A2B4E]"><Link to={`/trips/${trip.id}`} className="hover:underline">{trip.cmr_number || '-'}</Link></td>
                    <td className="px-4 py-3 text-slate-600">{trip.driver_name || '-'}</td>
                    <td className="px-4 py-3 text-slate-600">{trip.vehicle_plate || '-'}</td>
                    <td className="px-4 py-3 text-slate-600 max-w-xs">
                      <span className="line-clamp-1">{trip.shipper_name} → {trip.consignee_name}</span>
                    </td>
                    <td className="px-4 py-3 text-slate-500">{trip.loading_date ? new Date(trip.loading_date).toLocaleDateString('ro-RO') : '-'}</td>
                    <td className="px-4 py-3"><StatusBadge status={trip.status} /></td>
                    <td className="px-4 py-3 text-right">
                      <button onClick={() => { setEditTrip(trip); setShowForm(true); }} className="text-[#1D4E89] hover:underline text-xs font-medium">Editează</button>
                      <button onClick={() => handleDelete(trip.id)} className="text-red-500 hover:underline text-xs font-medium ml-3">Șterge</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="p-12 text-center text-slate-400">
            <Route className="w-10 h-10 mx-auto mb-3 opacity-40" />
            <p className="text-sm">Nu există curse. Creează prima cursă.</p>
          </div>
        )}
      </div>

      {showForm && <TripForm trip={editTrip} onClose={() => setShowForm(false)} onSave={handleSave} />}
    </div>
  );
}