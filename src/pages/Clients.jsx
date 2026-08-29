import React, { useEffect, useState } from 'react';
import { api } from '@/api/client';
import ClientForm from '@/components/ClientForm';
import SuggestSearch from '@/components/SuggestSearch';
import ConfirmDialog from '@/components/ConfirmDialog';
import { notifyError, notifySuccess } from '@/lib/notify';
import { Plus, Building2, Phone, Mail, MapPin } from 'lucide-react';

export default function Clients() {
  const [clients, setClients] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editClient, setEditClient] = useState(null);
  const [search, setSearch] = useState('');
  const [confirmAction, setConfirmAction] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => { loadClients(); }, []);

  const loadClients = async () => {
    try { setClients(await api.entities.Client.list()); }
    catch (e) {
      console.error(e);
      notifyError('Nu am putut încărca clienții', e);
    }
    finally { setLoading(false); }
  };

  const runConfirm = async () => {
    if (!confirmAction) return;
    const { type, client } = confirmAction;
    setBusy(true);
    try {
      if (type === 'remove') {
        await api.entities.Client.delete(client.id);
        notifySuccess('Client șters', `${client.name || 'Clientul'} a fost eliminat.`);
      } else {
        await api.entities.Client.update(client.id, { is_active: false });
        notifySuccess('Client dezactivat', `${client.name || 'Clientul'} a fost dezactivat.`);
      }
      setConfirmAction(null);
      await loadClients();
    } catch (e) {
      notifyError(type === 'remove' ? 'Ștergere eșuată' : 'Dezactivare eșuată', e);
    } finally {
      setBusy(false);
    }
  };

  const handleReactivate = async (client) => {
    try {
      await api.entities.Client.update(client.id, { is_active: true });
      notifySuccess('Client reactivat', `${client.name || 'Clientul'} este din nou activ.`);
      await loadClients();
    } catch (e) {
      notifyError('Reactivare eșuată', e);
    }
  };

  const filtered = clients.filter(c =>
    !search || c.name?.toLowerCase().includes(search.toLowerCase()) ||
    c.cui?.toLowerCase().includes(search.toLowerCase()) ||
    c.contact_person?.toLowerCase().includes(search.toLowerCase())
  );

  if (loading) return <div className="flex items-center justify-center h-96"><div className="w-8 h-8 border-4 border-slate-200 border-t-[#0A2B4E] rounded-full animate-spin" /></div>;

  const confirmCopy =
    confirmAction?.type === 'remove'
      ? {
          title: 'Șterge clientul?',
          description: `Ștergeți definitiv ${confirmAction.client?.name || 'acest client'}? Acțiunea nu poate fi anulată, iar facturile și cursele deja emise pe el rămân fără client legat.`,
          confirmLabel: 'Șterge definitiv',
          variant: 'danger',
        }
      : {
          title: 'Dezactivează clientul?',
          description: `${confirmAction?.client?.name || 'Clientul'} rămâne în listă marcat Inactiv. Îl poți reactiva sau șterge ulterior.`,
          confirmLabel: 'Dezactivează',
          variant: 'warning',
        };

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

      <SuggestSearch
        className="max-w-md"
        value={search}
        onChange={setSearch}
        items={clients}
        placeholder="Caută după denumire, CUI, contact..."
        getItem={(c) => ({
          id: c.id,
          title: c.name || 'Client',
          subtitle: [c.cui ? `CUI ${c.cui}` : null, c.contact_person].filter(Boolean).join(' · '),
          filterValue: c.name || '',
          searchText: [c.name, c.cui, c.contact_person].join(' '),
        })}
      />

      {filtered.length > 0 ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filtered.map(c => (
            <div key={c.id} className={`bg-white rounded-xl border border-slate-200/80 p-5 shadow-sm hover:shadow-md transition-shadow ${c.is_active === false ? 'opacity-70' : ''}`}>
              <div className="flex items-start gap-3 mb-3">
                <div className={`w-11 h-11 rounded-lg flex items-center justify-center ${c.is_active === false ? 'bg-slate-400' : 'bg-[#1D4E89]'}`}>
                  <Building2 className="w-5 h-5 text-white" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 min-w-0">
                    <p className="font-semibold text-[#0A2B4E] truncate">{c.name}</p>
                    {c.is_active === false && (
                      <span className="shrink-0 text-[10px] font-medium uppercase tracking-wide text-slate-500 bg-slate-100 rounded-full px-2 py-0.5">Inactiv</span>
                    )}
                  </div>
                  <p className="text-xs text-slate-500">CUI: {c.cui || '-'}</p>
                </div>
              </div>
              <div className="space-y-1.5 text-sm text-slate-600">
                {c.contact_person && <p className="text-xs text-slate-500">Contact: {c.contact_person}</p>}
                {c.address && <p className="flex items-center gap-2 text-xs truncate"><MapPin className="w-3.5 h-3.5 text-slate-400 shrink-0" /> {c.address}</p>}
                {c.phone && <p className="flex items-center gap-2 text-xs"><Phone className="w-3.5 h-3.5 text-slate-400" /> {c.phone}</p>}
                {c.email && <p className="flex items-center gap-2 text-xs truncate"><Mail className="w-3.5 h-3.5 text-slate-400" /> {c.email}</p>}
              </div>
              <div className="flex flex-wrap gap-2 mt-3 pt-3 border-t border-slate-100">
                <button onClick={() => { setEditClient(c); setShowForm(true); }} className="flex-1 min-w-[5.5rem] text-xs font-medium text-[#1D4E89] bg-blue-50 rounded-lg py-1.5 hover:bg-blue-100">Editează</button>
                {c.is_active === false ? (
                  <>
                    <button onClick={() => handleReactivate(c)} className="flex-1 min-w-[5.5rem] text-xs font-medium text-emerald-700 bg-emerald-50 rounded-lg py-1.5 hover:bg-emerald-100">Reactivează</button>
                    <button onClick={() => setConfirmAction({ type: 'remove', client: c })} className="flex-1 min-w-[5.5rem] text-xs font-medium text-red-600 bg-red-50 rounded-lg py-1.5 hover:bg-red-100">Șterge</button>
                  </>
                ) : (
                  <button onClick={() => setConfirmAction({ type: 'deactivate', client: c })} className="flex-1 min-w-[5.5rem] text-xs font-medium text-amber-700 bg-amber-50 rounded-lg py-1.5 hover:bg-amber-100">Dezactivează</button>
                )}
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

      <ConfirmDialog
        open={Boolean(confirmAction)}
        onClose={() => { if (!busy) setConfirmAction(null); }}
        onConfirm={runConfirm}
        busy={busy}
        variant={confirmCopy.variant}
        title={confirmCopy.title}
        description={confirmCopy.description}
        confirmLabel={confirmCopy.confirmLabel}
      />
    </div>
  );
}