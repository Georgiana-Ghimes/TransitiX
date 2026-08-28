import React, { useEffect, useState } from 'react';
import { api } from '@/api/client';
import StatusBadge from '@/components/StatusBadge';
import VehicleForm from '@/components/VehicleForm';
import SuggestSearch from '@/components/SuggestSearch';
import ConfirmDialog from '@/components/ConfirmDialog';
import { toast } from '@/components/ui/use-toast';
import { Plus, Truck } from 'lucide-react';
import { notifyError } from '@/lib/notify';

export default function Vehicles() {
  const [vehicles, setVehicles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editVehicle, setEditVehicle] = useState(null);
  const [search, setSearch] = useState('');
  const [confirmAction, setConfirmAction] = useState(null); // { type, vehicle }
  const [busy, setBusy] = useState(false);

  useEffect(() => { loadVehicles(); }, []);

  const loadVehicles = async () => {
    try { setVehicles(await api.entities.Vehicle.list()); }
    catch (e) {
      console.error(e);
      toast({ title: 'Nu am putut încărca flota', description: e?.message || 'Reîncearcă.' });
    }
    finally { setLoading(false); }
  };

  const closeConfirm = () => {
    if (busy) return;
    setConfirmAction(null);
  };

  const runConfirm = async () => {
    if (!confirmAction?.vehicle) return;
    const { type, vehicle } = confirmAction;
    setBusy(true);
    try {
      if (type === 'deactivate') {
        await api.entities.Vehicle.update(vehicle.id, { is_active: false, status: 'inactive' });
        toast({ title: 'Vehicul dezactivat', description: `${vehicle.plate} rămâne în flotă ca inactiv.` });
      } else if (type === 'remove') {
        await api.entities.Vehicle.delete(vehicle.id);
        toast({ title: 'Vehicul șters', description: `${vehicle.plate} a fost eliminat din flotă.` });
      }
      setConfirmAction(null);
      await loadVehicles();
    } catch (e) {
      notifyError('Nu s-a putut actualiza vehiculul', e);
    } finally {
      setBusy(false);
    }
  };

  const handleReactivate = async (vehicle) => {
    try {
      await api.entities.Vehicle.update(vehicle.id, { is_active: true, status: 'available' });
      toast({ title: 'Vehicul reactivat', description: `${vehicle.plate} este din nou disponibil.` });
      await loadVehicles();
    } catch (e) {
      notifyError('Nu s-a putut reactiva vehiculul', e);
    }
  };

  const filtered = vehicles.filter(v =>
    !search || v.plate?.toLowerCase().includes(search.toLowerCase()) ||
    v.brand?.toLowerCase().includes(search.toLowerCase()) ||
    v.model?.toLowerCase().includes(search.toLowerCase())
  );

  if (loading) return <div className="flex items-center justify-center h-96"><div className="w-8 h-8 border-4 border-slate-200 border-t-[#0A2B4E] rounded-full animate-spin" /></div>;

  const confirmCopy =
    confirmAction?.type === 'remove'
      ? {
          title: 'Șterge vehiculul?',
          description: `Ștergeți definitiv ${confirmAction.vehicle?.plate || 'acest vehicul'} din flotă? Acțiunea nu poate fi anulată.`,
          confirmLabel: 'Șterge definitiv',
          variant: 'danger',
        }
      : {
          title: 'Dezactivează vehiculul?',
          description: `${confirmAction?.vehicle?.plate || 'Vehiculul'} va rămâne în flotă ca inactiv. Îl poți reactiva sau șterge ulterior.`,
          confirmLabel: 'Dezactivează',
          variant: 'warning',
        };

  return (
    <div className="space-y-5 max-w-7xl mx-auto">
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-2xl font-bold text-[#0A2B4E] tracking-tight">Flotă</h1>
          <p className="text-sm text-slate-500 mt-1">{filtered.length} vehicule</p>
        </div>
        <button onClick={() => { setEditVehicle(null); setShowForm(true); }} className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-[#0A2B4E] rounded-lg hover:bg-[#1D4E89] transition-colors">
          <Plus className="w-4 h-4" /> Vehicul nou
        </button>
      </div>

      <SuggestSearch
        className="max-w-md"
        value={search}
        onChange={setSearch}
        items={vehicles}
        placeholder="Caută după număr, marcă, model..."
        getItem={(v) => ({
          id: v.id,
          title: v.plate || 'Vehicul',
          subtitle: [v.brand, v.model, v.year].filter(Boolean).join(' · '),
          filterValue: v.plate || '',
          searchText: [v.plate, v.brand, v.model].join(' '),
        })}
      />

      {filtered.length > 0 ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filtered.map(v => (
            <div key={v.id} className="bg-white rounded-xl border border-slate-200/80 p-5 shadow-sm hover:shadow-md transition-shadow">
              <div className="flex items-start justify-between mb-3">
                <div className="flex items-center gap-3">
                  <div className="w-11 h-11 rounded-lg bg-[#0A2B4E] flex items-center justify-center">
                    <Truck className="w-5 h-5 text-white" />
                  </div>
                  <div>
                    <p className="font-semibold text-[#0A2B4E]">{v.plate}</p>
                    <p className="text-xs text-slate-500">{v.brand} {v.model} · {v.year}</p>
                  </div>
                </div>
                <StatusBadge status={v.status} type="vehicle" />
              </div>
              <div className="grid grid-cols-2 gap-2 text-xs">
                <div className="bg-slate-50 rounded-lg p-2"><p className="text-slate-400">Capacitate</p><p className="font-medium text-slate-700">{v.capacity_kg || '-'} kg</p></div>
                <div className="bg-slate-50 rounded-lg p-2"><p className="text-slate-400">Consum</p><p className="font-medium text-slate-700">{v.fuel_consumption || '-'} l/100km</p></div>
                <div className="bg-slate-50 rounded-lg p-2"><p className="text-slate-400">ITP</p><p className={`font-medium ${v.itp_expiry && new Date(v.itp_expiry) < new Date() ? 'text-red-600' : 'text-slate-700'}`}>{v.itp_expiry ? new Date(v.itp_expiry).toLocaleDateString('ro-RO') : '-'}</p></div>
                <div className="bg-slate-50 rounded-lg p-2"><p className="text-slate-400">RCA</p><p className={`font-medium ${v.rca_expiry && new Date(v.rca_expiry) < new Date() ? 'text-red-600' : 'text-slate-700'}`}>{v.rca_expiry ? new Date(v.rca_expiry).toLocaleDateString('ro-RO') : '-'}</p></div>
              </div>
              <div className="flex flex-wrap gap-2 mt-3 pt-3 border-t border-slate-100">
                <button onClick={() => { setEditVehicle(v); setShowForm(true); }} className="flex-1 min-w-[5.5rem] text-xs font-medium text-[#1D4E89] bg-blue-50 rounded-lg py-1.5 hover:bg-blue-100">Editează</button>
                {v.is_active !== false ? (
                  <button onClick={() => setConfirmAction({ type: 'deactivate', vehicle: v })} className="flex-1 min-w-[5.5rem] text-xs font-medium text-amber-700 bg-amber-50 rounded-lg py-1.5 hover:bg-amber-100">Dezactivează</button>
                ) : (
                  <>
                    <button onClick={() => handleReactivate(v)} className="flex-1 min-w-[5.5rem] text-xs font-medium text-emerald-700 bg-emerald-50 rounded-lg py-1.5 hover:bg-emerald-100">Reactivează</button>
                    <button onClick={() => setConfirmAction({ type: 'remove', vehicle: v })} className="flex-1 min-w-[5.5rem] text-xs font-medium text-red-600 bg-red-50 rounded-lg py-1.5 hover:bg-red-100">Șterge</button>
                  </>
                )}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-slate-200/80 p-12 text-center text-slate-400 shadow-sm">
          <Truck className="w-10 h-10 mx-auto mb-3 opacity-40" />
          <p className="text-sm">Nu există vehicule. Adaugă primul vehicul.</p>
        </div>
      )}

      {showForm && <VehicleForm vehicle={editVehicle} onClose={() => setShowForm(false)} onSave={() => { setShowForm(false); loadVehicles(); }} />}

      <ConfirmDialog
        open={Boolean(confirmAction)}
        onClose={closeConfirm}
        onConfirm={runConfirm}
        busy={busy}
        title={confirmCopy.title}
        description={confirmCopy.description}
        confirmLabel={confirmCopy.confirmLabel}
        variant={confirmCopy.variant}
      />
    </div>
  );
}
