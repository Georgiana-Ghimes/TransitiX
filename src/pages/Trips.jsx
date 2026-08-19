import React, { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '@/api/client';
import StatusBadge from '@/components/StatusBadge';
import TripForm from '@/components/TripForm';
import SuggestSearch from '@/components/SuggestSearch';
import ConfirmDialog from '@/components/ConfirmDialog';
import { formatDate } from '@/lib/utils';
import { notifyError, notifySuccess } from '@/lib/notify';
import { formatRon, tripMargin } from '@/lib/tripOps';
import { Plus, Download, Route } from 'lucide-react';

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
  const navigate = useNavigate();
  const [trips, setTrips] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editTrip, setEditTrip] = useState(null);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [confirmTrip, setConfirmTrip] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => { loadTrips(); }, []);

  const loadTrips = async () => {
    try {
      const data = await api.entities.Trip.list('-created_date', 200);
      setTrips(data);
    } catch (e) { console.error(e); }
    finally { setLoading(false); }
  };

  const handleSave = async () => {
    setShowForm(false);
    setEditTrip(null);
    await loadTrips();
  };

  const runDelete = async () => {
    if (!confirmTrip) return;
    setBusy(true);
    try {
      await api.entities.Trip.delete(confirmTrip.id);
      notifySuccess('Cursă ștearsă', `${confirmTrip.cmr_number || 'Cursa'} a fost eliminată.`);
      setConfirmTrip(null);
      await loadTrips();
    } catch (e) {
      notifyError('Ștergere eșuată', e);
    } finally {
      setBusy(false);
    }
  };

  const filtered = trips.filter(t => {
    const matchesSearch = !search ||
      t.cmr_number?.toLowerCase().includes(search.toLowerCase()) ||
      t.driver_name?.toLowerCase().includes(search.toLowerCase()) ||
      t.vehicle_plate?.toLowerCase().includes(search.toLowerCase()) ||
      t.shipper_name?.toLowerCase().includes(search.toLowerCase()) ||
      t.consignee_name?.toLowerCase().includes(search.toLowerCase()) ||
      t.uit_code?.toLowerCase().includes(search.toLowerCase());
    const matchesStatus = statusFilter === 'all' || t.status === statusFilter;
    return matchesSearch && matchesStatus;
  });

  const exportCSV = () => {
    const headers = ['CMR', 'UIT', 'Șofer', 'Vehicul', 'Expeditor', 'Destinatar', 'Status', 'Data încărcării', 'Venit', 'Cost', 'Marjă'];
    const rows = filtered.map(t => [
      t.cmr_number, t.uit_code, t.driver_name, t.vehicle_plate, t.shipper_name, t.consignee_name, t.status, t.loading_date,
      t.agreed_revenue, t.estimated_cost, tripMargin(t.agreed_revenue, t.estimated_cost),
    ]);
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
        <SuggestSearch
          className="w-full min-w-0 sm:flex-1 sm:min-w-[240px] max-w-md"
          value={search}
          onChange={setSearch}
          items={trips}
          placeholder="Caută după CMR, șofer, vehicul, expeditor..."
          getItem={(t) => ({
            id: t.id,
            title: t.cmr_number || 'Fără CMR',
            subtitle: [t.driver_name, t.vehicle_plate, t.shipper_name].filter(Boolean).join(' · '),
            filterValue: t.cmr_number || t.driver_name || t.vehicle_plate || '',
            searchText: [t.cmr_number, t.driver_name, t.vehicle_plate, t.shipper_name, t.consignee_name].join(' '),
          })}
          onSelect={(item) => navigate(`/trips/${item.id}`)}
        />
        <div className="flex gap-1.5 flex-wrap w-full sm:w-auto">
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

      {/* Mobile cards */}
      <div className="md:hidden space-y-3">
        {filtered.length > 0 ? filtered.map((trip) => (
          <div key={trip.id} className="bg-white rounded-xl border border-slate-200/80 shadow-sm p-4">
            <div className="flex items-start justify-between gap-3 mb-2">
              <Link to={`/trips/${trip.id}`} className="font-semibold text-[#0A2B4E] hover:underline min-w-0 truncate">
                {trip.cmr_number || '-'}
              </Link>
              <StatusBadge status={trip.status} />
            </div>
            <p className="text-sm text-slate-600 line-clamp-2">{trip.shipper_name} → {trip.consignee_name}</p>
            <p className="text-xs text-slate-500 mt-2">
              {[trip.driver_name, trip.vehicle_plate, formatDate(trip.loading_date)].filter(Boolean).join(' · ') || '—'}
            </p>
            {(trip.uit_code || tripMargin(trip.agreed_revenue, trip.estimated_cost) != null) && (
              <p className="text-xs text-slate-500 mt-1">
                {trip.uit_code ? `UIT ${trip.uit_code}` : ''}
                {trip.uit_code && tripMargin(trip.agreed_revenue, trip.estimated_cost) != null ? ' · ' : ''}
                {tripMargin(trip.agreed_revenue, trip.estimated_cost) != null
                  ? `Marjă ${formatRon(tripMargin(trip.agreed_revenue, trip.estimated_cost))}`
                  : ''}
              </p>
            )}
            <div className="flex gap-3 mt-3 pt-3 border-t border-slate-100">
              <button onClick={() => { setEditTrip(trip); setShowForm(true); }} className="text-[#1D4E89] hover:underline text-xs font-medium">Editează</button>
              <button onClick={() => setConfirmTrip(trip)} className="text-red-500 hover:underline text-xs font-medium">Șterge</button>
            </div>
          </div>
        )) : (
          <div className="bg-white rounded-xl border border-slate-200/80 p-10 text-center text-slate-400 shadow-sm">
            <Route className="w-10 h-10 mx-auto mb-3 opacity-40" />
            <p className="text-sm font-medium text-slate-600">Nu există curse</p>
          </div>
        )}
      </div>

      {/* Desktop table */}
      <div className="hidden md:block bg-white rounded-xl border border-slate-200/80 shadow-sm overflow-hidden">
        {filtered.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[900px]">
              <thead>
                <tr className="border-b border-slate-100 text-slate-500 text-xs">
                  <th className="text-left font-medium px-4 py-3">CMR</th>
                  <th className="text-left font-medium px-4 py-3">Șofer</th>
                  <th className="text-left font-medium px-4 py-3">Vehicul</th>
                  <th className="text-left font-medium px-4 py-3">Expeditor → Destinatar</th>
                  <th className="text-left font-medium px-4 py-3">UIT</th>
                  <th className="text-right font-medium px-4 py-3">Marjă</th>
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
                    <td className="px-4 py-3 text-slate-500 font-mono text-xs">{trip.uit_code || '—'}</td>
                    <td className="px-4 py-3 text-right text-slate-600 tabular-nums">
                      {formatRon(tripMargin(trip.agreed_revenue, trip.estimated_cost))}
                    </td>
                    <td className="px-4 py-3 text-slate-500">{formatDate(trip.loading_date)}</td>
                    <td className="px-4 py-3"><StatusBadge status={trip.status} /></td>
                    <td className="px-4 py-3 text-right">
                      <button onClick={() => { setEditTrip(trip); setShowForm(true); }} className="text-[#1D4E89] hover:underline text-xs font-medium">Editează</button>
                      <button onClick={() => setConfirmTrip(trip)} className="text-red-500 hover:underline text-xs font-medium ml-3">Șterge</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="p-12 text-center text-slate-400">
            <Route className="w-10 h-10 mx-auto mb-3 opacity-40" />
            <p className="text-sm font-medium text-slate-600">Nu există curse</p>
            <p className="text-xs mt-1 mb-4">Creează o cursă și alocă șofer + vehicul.</p>
            <button onClick={() => { setEditTrip(null); setShowForm(true); }} className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-[#0A2B4E] rounded-lg hover:bg-[#1D4E89]">
              <Plus className="w-4 h-4" /> Cursă nouă
            </button>
          </div>
        )}
      </div>

      {showForm && <TripForm trip={editTrip} onClose={() => setShowForm(false)} onSave={handleSave} />}

      <ConfirmDialog
        open={Boolean(confirmTrip)}
        onClose={() => { if (!busy) setConfirmTrip(null); }}
        onConfirm={runDelete}
        busy={busy}
        variant="danger"
        title="Șterge cursa?"
        description={`Ștergeți definitiv ${confirmTrip?.cmr_number || 'această cursă'}? Acțiunea nu poate fi anulată.`}
        confirmLabel="Șterge definitiv"
      />
    </div>
  );
}