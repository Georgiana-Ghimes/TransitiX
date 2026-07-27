import React, { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { base44 } from '@/api/base44Client';
import StatusBadge from '@/components/StatusBadge';
import { Truck, CheckCircle, FileText, Download, Camera, Loader2, Package, MapPin } from 'lucide-react';

export default function ClientPortal() {
  const { token } = useParams();
  const [confirmation, setConfirmation] = useState(null);
  const [trip, setTrip] = useState(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [observations, setObservations] = useState('');
  const [hasDamage, setHasDamage] = useState(false);
  const [damageDesc, setDamageDesc] = useState('');
  const [confirmed, setConfirmed] = useState(false);

  useEffect(() => { loadData(); }, [token]);

  const loadData = async () => {
    try {
      const confs = await base44.entities.ClientConfirmation.filter({ token });
      if (confs.length > 0) {
        const conf = confs[0];
        setConfirmation(conf);
        setConfirmed(conf.status === 'confirmed');
        setObservations(conf.observations || '');
        setHasDamage(conf.has_damage || false);
        setDamageDesc(conf.damage_description || '');
        if (conf.trip_id) {
          try { setTrip(await base44.entities.Trip.get(conf.trip_id)); } catch (e) { }
        }
      }
    } catch (e) { console.error(e); }
    finally { setLoading(false); }
  };

  const handleConfirm = async () => {
    setSubmitting(true);
    try {
      await base44.entities.ClientConfirmation.update(confirmation.id, {
        status: 'confirmed',
        confirmed_at: new Date().toISOString(),
        confirmed_by_name: trip?.consignee_name || 'Client',
        observations,
        has_damage: hasDamage,
        damage_description: hasDamage ? damageDesc : '',
      });
      setConfirmed(true);
    } catch (e) { console.error(e); alert('Eroare: ' + (e.message || '')); }
    finally { setSubmitting(false); }
  };

  if (loading) return <div className="flex items-center justify-center h-screen"><div className="w-8 h-8 border-4 border-slate-200 border-t-[#0A2B4E] rounded-full animate-spin" /></div>;

  if (!confirmation) {
    return (
      <div className="min-h-screen bg-[#F8F9FA] flex items-center justify-center p-4">
        <div className="bg-white rounded-2xl shadow-lg p-8 max-w-md w-full text-center">
          <div className="w-16 h-16 mx-auto rounded-2xl bg-red-50 flex items-center justify-center mb-4"><FileText className="w-8 h-8 text-red-400" /></div>
          <h1 className="font-bold text-[#0A2B4E] text-lg mb-2">Link invalid</h1>
          <p className="text-sm text-slate-500">Acest link de confirmare nu este valid sau a expirat. Contactați transportatorul pentru asistență.</p>
        </div>
      </div>
    );
  }

  if (confirmed) {
    return (
      <div className="min-h-screen bg-[#F8F9FA] flex items-center justify-center p-4">
        <div className="bg-white rounded-2xl shadow-lg p-8 max-w-md w-full text-center">
          <div className="w-16 h-16 mx-auto rounded-2xl bg-emerald-50 flex items-center justify-center mb-4"><CheckCircle className="w-8 h-8 text-emerald-500" /></div>
          <h1 className="font-bold text-[#0A2B4E] text-lg mb-2">Confirmare înregistrată</h1>
          <p className="text-sm text-slate-500 mb-4">Recepția mărfii pentru CMR <span className="font-semibold text-[#0A2B4E]">{confirmation.cmr_number}</span> a fost confirmată cu succes.</p>
          {observations && <div className="p-3 bg-slate-50 rounded-lg text-left mb-4"><p className="text-xs text-slate-400 mb-1">Observațiile dumneavoastră:</p><p className="text-sm text-slate-600">{observations}</p></div>}
          <button className="flex items-center gap-2 mx-auto px-5 py-2.5 text-sm font-medium text-white bg-[#0A2B4E] rounded-lg hover:bg-[#1D4E89]"><Download className="w-4 h-4" /> Descarcă PDF CMR</button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#F8F9FA] py-8 px-4">
      <div className="max-w-2xl mx-auto">
        {/* Header */}
        <div className="bg-[#0A2B4E] rounded-2xl p-6 text-white mb-5">
          <div className="flex items-center gap-3 mb-2">
            <div className="w-10 h-10 rounded-lg bg-[#F5A623] flex items-center justify-center"><Truck className="w-5 h-5 text-[#0A2B4E]" /></div>
            <div><p className="text-xs text-white/60">TRANSITIX</p><p className="font-bold">Confirmare recepție marfă</p></div>
          </div>
          <h1 className="text-2xl font-bold">CMR {confirmation.cmr_number}</h1>
        </div>

        {/* Trip details */}
        {trip && (
          <div className="bg-white rounded-2xl shadow-sm p-6 mb-5 space-y-4">
            <div className="flex items-start gap-3 pb-4 border-b border-slate-100">
              <div className="w-2.5 h-2.5 rounded-full bg-[#F5A623] mt-1.5" />
              <div className="flex-1">
                <p className="text-xs text-slate-400">EXPEDITOR</p>
                <p className="font-medium text-slate-700">{trip.shipper_name}</p>
                {trip.shipper_address && <p className="text-sm text-slate-500">{trip.shipper_address}</p>}
              </div>
            </div>
            <div className="flex items-start gap-3">
              <div className="w-2.5 h-2.5 rounded-full bg-[#27AE60] mt-1.5" />
              <div className="flex-1">
                <p className="text-xs text-slate-400">DESTINATAR</p>
                <p className="font-medium text-slate-700">{trip.consignee_name}</p>
                {trip.consignee_address && <p className="text-sm text-slate-500">{trip.consignee_address}</p>}
              </div>
            </div>
            <div className="grid grid-cols-3 gap-3 pt-4 border-t border-slate-100">
              <div className="text-center"><Package className="w-4 h-4 text-slate-400 mx-auto mb-1" /><p className="text-xs text-slate-400">Greutate</p><p className="text-sm font-medium text-slate-700">{trip.weight_kg ? trip.weight_kg + ' kg' : '-'}</p></div>
              <div className="text-center"><Package className="w-4 h-4 text-slate-400 mx-auto mb-1" /><p className="text-xs text-slate-400">Colete</p><p className="text-sm font-medium text-slate-700">{trip.package_count || '-'}</p></div>
              <div className="text-center"><MapPin className="w-4 h-4 text-slate-400 mx-auto mb-1" /><p className="text-xs text-slate-400">Distanță</p><p className="text-sm font-medium text-slate-700">{trip.distance_km ? trip.distance_km + ' km' : '-'}</p></div>
            </div>
            {trip.goods_description && <div className="p-3 bg-slate-50 rounded-lg"><p className="text-xs text-slate-400 mb-1">Descriere marfă</p><p className="text-sm text-slate-600">{trip.goods_description}</p></div>}
          </div>
        )}

        {/* Confirmation form */}
        <div className="bg-white rounded-2xl shadow-sm p-6 space-y-4">
          <h2 className="font-semibold text-[#0A2B4E]">Confirmați recepția mărfii</h2>

          <div>
            <label className="text-sm font-medium text-slate-600 block mb-2">Observații (opțional)</label>
            <textarea rows={3} value={observations} onChange={e => setObservations(e.target.value)} placeholder="Adăugați observații despre livrare..." className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:border-[#1D4E89]" />
          </div>

          <label className="flex items-center gap-3 cursor-pointer">
            <input type="checkbox" checked={hasDamage} onChange={e => setHasDamage(e.target.checked)} className="w-4 h-4 rounded" />
            <span className="text-sm text-slate-600">Marfa prezintă avarii</span>
          </label>

          {hasDamage && (
            <div>
              <label className="text-sm font-medium text-slate-600 block mb-2">Descriere avarii</label>
              <textarea rows={2} value={damageDesc} onChange={e => setDamageDesc(e.target.value)} placeholder="Descrieți avariile..." className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:border-[#1D4E89]" />
            </div>
          )}

          <button onClick={handleConfirm} disabled={submitting} className="flex items-center justify-center gap-2 w-full px-5 py-3 text-sm font-medium text-white bg-[#27AE60] rounded-lg hover:bg-emerald-600 disabled:opacity-50 transition-colors min-h-[48px]">
            {submitting ? <Loader2 className="w-5 h-5 animate-spin" /> : <CheckCircle className="w-5 h-5" />}
            {submitting ? 'Se confirmă...' : 'Confirm primirea mărfii'}
          </button>
        </div>

        <p className="text-center text-xs text-slate-400 mt-5">Acest link este valabil 30 de zile. Pentru asistență contactați transportatorul.</p>
      </div>
    </div>
  );
}