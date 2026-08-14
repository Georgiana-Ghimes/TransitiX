import React, { useEffect, useState } from 'react';
import { api } from '@/api/client';
import StatusBadge from '@/components/StatusBadge';
import DriverForm from '@/components/DriverForm';
import SuggestSearch from '@/components/SuggestSearch';
import ConfirmDialog from '@/components/ConfirmDialog';
import { notifyError, notifySuccess } from '@/lib/notify';
import { Plus, Users, Phone, Mail } from 'lucide-react';

export default function Drivers() {
  const [drivers, setDrivers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editDriver, setEditDriver] = useState(null);
  const [search, setSearch] = useState('');
  const [confirmAction, setConfirmAction] = useState(null); // { type, driver }
  const [busy, setBusy] = useState(false);

  useEffect(() => { loadDrivers(); }, []);

  const loadDrivers = async () => {
    try { setDrivers(await api.entities.Driver.list()); }
    catch (e) { console.error(e); }
    finally { setLoading(false); }
  };

  const closeConfirm = () => {
    if (busy) return;
    setConfirmAction(null);
  };

  const runConfirm = async () => {
    if (!confirmAction?.driver) return;
    const { type, driver } = confirmAction;
    setBusy(true);
    try {
      if (type === 'deactivate') {
        await api.entities.Driver.update(driver.id, { is_active: false, status: 'indisponibil' });
        notifySuccess('Șofer dezactivat', `${driver.name || 'Șoferul'} a fost marcat indisponibil.`);
      } else if (type === 'remove') {
        await api.entities.Driver.delete(driver.id);
        notifySuccess('Șofer șters', `${driver.name || 'Șoferul'} a fost eliminat.`);
      }
      setConfirmAction(null);
      await loadDrivers();
    } catch (e) {
      notifyError(type === 'remove' ? 'Ștergere eșuată' : 'Dezactivare eșuată', e);
    } finally {
      setBusy(false);
    }
  };

  const handleReactivate = async (driver) => {
    try {
      await api.entities.Driver.update(driver.id, { is_active: true, status: 'disponibil' });
      notifySuccess('Șofer reactivat', `${driver.name || 'Șoferul'} este din nou disponibil.`);
      await loadDrivers();
    } catch (e) {
      notifyError('Reactivare eșuată', e);
    }
  };

  const filtered = drivers.filter(d =>
    !search || d.name?.toLowerCase().includes(search.toLowerCase()) ||
    d.phone?.toLowerCase().includes(search.toLowerCase()) ||
    d.email?.toLowerCase().includes(search.toLowerCase())
  );

  if (loading) return <div className="flex items-center justify-center h-96"><div className="w-8 h-8 border-4 border-slate-200 border-t-[#0A2B4E] rounded-full animate-spin" /></div>;

  const confirmCopy =
    confirmAction?.type === 'remove'
      ? {
          title: 'Șterge șoferul?',
          description: `Ștergeți definitiv ${confirmAction.driver?.name || 'acest șofer'}? Acțiunea nu poate fi anulată.`,
          confirmLabel: 'Șterge definitiv',
          variant: 'danger',
        }
      : {
          title: 'Dezactivează șoferul?',
          description: `${confirmAction?.driver?.name || 'Șoferul'} va rămâne în listă ca indisponibil. Îl poți reactiva sau șterge ulterior.`,
          confirmLabel: 'Dezactivează',
          variant: 'warning',
        };

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

      <SuggestSearch
        className="max-w-md"
        value={search}
        onChange={setSearch}
        items={drivers}
        placeholder="Caută după nume, telefon, email..."
        getItem={(d) => ({
          id: d.id,
          title: d.name || 'Șofer',
          subtitle: [d.phone, d.email].filter(Boolean).join(' · '),
          filterValue: d.name || '',
          searchText: [d.name, d.phone, d.email].join(' '),
        })}
      />

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
              <div className="flex flex-wrap gap-2 mt-3 pt-3 border-t border-slate-100">
                <button onClick={() => { setEditDriver(d); setShowForm(true); }} className="flex-1 min-w-[5.5rem] text-xs font-medium text-[#1D4E89] bg-blue-50 rounded-lg py-1.5 hover:bg-blue-100">Editează</button>
                {d.is_active !== false ? (
                  <button onClick={() => setConfirmAction({ type: 'deactivate', driver: d })} className="flex-1 min-w-[5.5rem] text-xs font-medium text-amber-700 bg-amber-50 rounded-lg py-1.5 hover:bg-amber-100">Dezactivează</button>
                ) : (
                  <>
                    <button onClick={() => handleReactivate(d)} className="flex-1 min-w-[5.5rem] text-xs font-medium text-emerald-700 bg-emerald-50 rounded-lg py-1.5 hover:bg-emerald-100">Reactivează</button>
                    <button onClick={() => setConfirmAction({ type: 'remove', driver: d })} className="flex-1 min-w-[5.5rem] text-xs font-medium text-red-600 bg-red-50 rounded-lg py-1.5 hover:bg-red-100">Șterge</button>
                  </>
                )}
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