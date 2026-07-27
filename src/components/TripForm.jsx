import React, { useEffect, useState } from 'react';
import { api } from '@/api/client';
import { X, Save } from 'lucide-react';
import ModalShell from '@/components/ModalShell';

export default function TripForm({ trip, onClose, onSave }) {
  const [drivers, setDrivers] = useState([]);
  const [vehicles, setVehicles] = useState([]);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    cmr_number: '', driver_id: '', driver_name: '', vehicle_id: '', vehicle_plate: '',
    shipper_name: '', shipper_address: '', shipper_contact: '', shipper_phone: '', shipper_email: '',
    consignee_name: '', consignee_address: '', consignee_contact: '', consignee_phone: '', consignee_email: '',
    loading_date: '', loading_time: '', estimated_delivery_date: '', estimated_delivery_time: '',
    goods_description: '', weight_kg: '', package_count: '', volume_mc: '',
    special_instructions: '', internal_notes: '', distance_km: '', status: 'planificata',
    ...trip,
  });

  useEffect(() => {
    Promise.all([api.entities.Driver.list(), api.entities.Vehicle.list()]).then(([d, v]) => {
      setDrivers(d.filter(x => x.is_active));
      setVehicles(v.filter(x => x.is_active));
    });
  }, []);

  const set = (k, val) => setForm(f => ({ ...f, [k]: val }));

  const onDriverChange = (id) => {
    const d = drivers.find(x => x.id === id);
    setForm(f => ({
      ...f,
      driver_id: id || '',
      driver_name: d?.name || '',
      // TMS rule: assigning a driver moves the trip into the active queue
      status: id && ['planificata', 'alocata'].includes(f.status) ? 'alocata' : f.status,
    }));
  };
  const onVehicleChange = (id) => {
    const v = vehicles.find(x => x.id === id);
    set('vehicle_id', id);
    set('vehicle_plate', v?.plate || '');
  };

  const generateCMR = () => {
    const now = new Date();
    const y = now.getFullYear();
    const m = String(now.getMonth() + 1).padStart(2, '0');
    const d = String(now.getDate()).padStart(2, '0');
    const rand = String(Math.floor(Math.random() * 9000) + 1000);
    set('cmr_number', `CMR-${y}-${m}${d}-${rand}`);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      const data = {
        ...form,
        driver_id: form.driver_id || null,
        vehicle_id: form.vehicle_id || null,
        weight_kg: form.weight_kg ? Number(form.weight_kg) : null,
        package_count: form.package_count ? Number(form.package_count) : null,
        volume_mc: form.volume_mc ? Number(form.volume_mc) : null,
        distance_km: form.distance_km ? Number(form.distance_km) : null,
      };
      if (data.driver_id && ['planificata', ''].includes(data.status || 'planificata')) {
        data.status = 'alocata';
      }
      if (!data.driver_id && data.status === 'alocata') {
        data.status = 'planificata';
      }

      let saved;
      if (trip?.id) {
        saved = await api.entities.Trip.update(trip.id, data);
      } else {
        if (!data.cmr_number) {
          const now = new Date();
          const y = now.getFullYear();
          const m = String(now.getMonth() + 1).padStart(2, '0');
          const d = String(now.getDate()).padStart(2, '0');
          const rand = String(Math.floor(Math.random() * 9000) + 1000);
          data.cmr_number = `CMR-${y}-${m}${d}-${rand}`;
        }
        saved = await api.entities.Trip.create(data);
      }

      // Notify driver queue when a trip is assigned
      if (data.driver_id && data.status === 'alocata') {
        try {
          await api.entities.DriverNotification.create({
            title: 'Cursă nouă alocată',
            message: `Ai primit cursa ${data.cmr_number}: ${data.shipper_name} → ${data.consignee_name}.`,
            type: 'trip_assigned',
            trip_id: saved?.id || trip?.id,
            cmr_number: data.cmr_number,
            is_read: false,
          });
        } catch {
          // non-blocking
        }
      }
      onSave();
    } catch (e) {
      console.error(e);
      alert('Eroare la salvare: ' + (e.message || 'unknown'));
    } finally { setSaving(false); }
  };

  const inputCls = "w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:border-[#1D4E89] transition-colors";
  const labelCls = "block text-xs font-medium text-slate-600 mb-1";

  return (
    <ModalShell onClose={onClose} panelClassName="max-w-3xl" labelledBy="trip-form-title">
      <div className="sticky top-0 bg-white border-b border-slate-100 px-6 py-4 flex items-center justify-between z-10">
          <h2 id="trip-form-title" className="font-semibold text-[#0A2B4E]">{trip ? 'Editează cursă' : 'Cursă nouă'}</h2>
          <button type="button" onClick={onClose} className="p-1.5 rounded-lg hover:bg-slate-100"><X className="w-5 h-5 text-slate-500" /></button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-5">
          {/* CMR + Status */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="sm:col-span-2">
              <label className={labelCls}>Număr CMR</label>
              <div className="flex gap-2">
                <input className={inputCls} value={form.cmr_number} onChange={e => set('cmr_number', e.target.value)} placeholder="Generat automat" />
                <button type="button" onClick={generateCMR} className="px-3 py-2 text-xs font-medium text-[#1D4E89] bg-blue-50 rounded-lg hover:bg-blue-100 whitespace-nowrap">Generează</button>
              </div>
            </div>
            <div>
              <label className={labelCls}>Status</label>
              <select className={inputCls} value={form.status} onChange={e => set('status', e.target.value)}>
                <option value="planificata">De planificat</option>
                <option value="alocata">Alocată</option>
                <option value="incarcata">Încărcată</option>
                <option value="in_tranzit">În tranzit</option>
                <option value="livrata">Livrată</option>
                <option value="problema">Problemă</option>
                <option value="anulata">Anulată</option>
              </select>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className={labelCls}>Șofer</label>
              <select className={inputCls} value={form.driver_id} onChange={e => onDriverChange(e.target.value)}>
                <option value="">Selectează șofer</option>
                {drivers.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
              </select>
            </div>
            <div>
              <label className={labelCls}>Vehicul</label>
              <select className={inputCls} value={form.vehicle_id} onChange={e => onVehicleChange(e.target.value)}>
                <option value="">Selectează vehicul</option>
                {vehicles.map(v => <option key={v.id} value={v.id}>{v.plate} — {v.brand} {v.model}</option>)}
              </select>
            </div>
          </div>

          {/* Shipper */}
          <div className="space-y-3">
            <h3 className="text-sm font-semibold text-[#0A2B4E] border-l-2 border-[#F5A623] pl-2">Expeditor</h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div><label className={labelCls}>Nume expeditor *</label><input required className={inputCls} value={form.shipper_name} onChange={e => set('shipper_name', e.target.value)} /></div>
              <div><label className={labelCls}>Contact</label><input className={inputCls} value={form.shipper_contact} onChange={e => set('shipper_contact', e.target.value)} /></div>
              <div className="sm:col-span-2"><label className={labelCls}>Adresă</label><input className={inputCls} value={form.shipper_address} onChange={e => set('shipper_address', e.target.value)} /></div>
              <div><label className={labelCls}>Telefon</label><input className={inputCls} value={form.shipper_phone} onChange={e => set('shipper_phone', e.target.value)} /></div>
              <div><label className={labelCls}>Email</label><input type="email" className={inputCls} value={form.shipper_email || ''} onChange={e => set('shipper_email', e.target.value)} /></div>
            </div>
          </div>

          {/* Consignee */}
          <div className="space-y-3">
            <h3 className="text-sm font-semibold text-[#0A2B4E] border-l-2 border-[#27AE60] pl-2">Destinatar</h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div><label className={labelCls}>Nume destinatar *</label><input required className={inputCls} value={form.consignee_name} onChange={e => set('consignee_name', e.target.value)} /></div>
              <div><label className={labelCls}>Contact</label><input className={inputCls} value={form.consignee_contact} onChange={e => set('consignee_contact', e.target.value)} /></div>
              <div className="sm:col-span-2"><label className={labelCls}>Adresă</label><input className={inputCls} value={form.consignee_address} onChange={e => set('consignee_address', e.target.value)} /></div>
              <div><label className={labelCls}>Telefon</label><input className={inputCls} value={form.consignee_phone} onChange={e => set('consignee_phone', e.target.value)} /></div>
              <div><label className={labelCls}>Email</label><input type="email" className={inputCls} value={form.consignee_email || ''} onChange={e => set('consignee_email', e.target.value)} /></div>
            </div>
          </div>

          {/* Dates */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            <div><label className={labelCls}>Data încărcării *</label><input required type="date" className={inputCls} value={form.loading_date} onChange={e => set('loading_date', e.target.value)} /></div>
            <div><label className={labelCls}>Ora încărcării</label><input type="time" className={inputCls} value={form.loading_time || ''} onChange={e => set('loading_time', e.target.value)} /></div>
            <div><label className={labelCls}>Data livrării est.</label><input type="date" className={inputCls} value={form.estimated_delivery_date || ''} onChange={e => set('estimated_delivery_date', e.target.value)} /></div>
            <div><label className={labelCls}>Ora livrării est.</label><input type="time" className={inputCls} value={form.estimated_delivery_time || ''} onChange={e => set('estimated_delivery_time', e.target.value)} /></div>
          </div>

          {/* Goods */}
          <div className="space-y-3">
            <h3 className="text-sm font-semibold text-[#0A2B4E] border-l-2 border-[#1D4E89] pl-2">Marfă</h3>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
              <div><label className={labelCls}>Greutate (kg)</label><input type="number" step="0.01" className={inputCls} value={form.weight_kg} onChange={e => set('weight_kg', e.target.value)} /></div>
              <div><label className={labelCls}>Colete</label><input type="number" className={inputCls} value={form.package_count} onChange={e => set('package_count', e.target.value)} /></div>
              <div><label className={labelCls}>Volum (mc)</label><input type="number" step="0.01" className={inputCls} value={form.volume_mc} onChange={e => set('volume_mc', e.target.value)} /></div>
              <div><label className={labelCls}>Distanță (km)</label><input type="number" className={inputCls} value={form.distance_km} onChange={e => set('distance_km', e.target.value)} /></div>
            </div>
            <div><label className={labelCls}>Descriere marfă</label><textarea rows={2} className={inputCls} value={form.goods_description} onChange={e => set('goods_description', e.target.value)} /></div>
          </div>

          {/* Notes */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div><label className={labelCls}>Instrucțiuni speciale</label><textarea rows={2} className={inputCls} value={form.special_instructions} onChange={e => set('special_instructions', e.target.value)} /></div>
            <div><label className={labelCls}>Note interne</label><textarea rows={2} className={inputCls} value={form.internal_notes} onChange={e => set('internal_notes', e.target.value)} /></div>
          </div>

          <div className="flex gap-3 pt-2 border-t border-slate-100">
            <button type="submit" disabled={saving} className="flex items-center gap-2 px-5 py-2.5 text-sm font-medium text-white bg-[#0A2B4E] rounded-lg hover:bg-[#1D4E89] disabled:opacity-50 transition-colors">
              <Save className="w-4 h-4" /> {saving ? 'Se salvează...' : 'Salvează'}
            </button>
            <button type="button" onClick={onClose} className="px-5 py-2.5 text-sm font-medium text-slate-600 bg-white border border-slate-200 rounded-lg hover:bg-slate-50 transition-colors">Anulează</button>
          </div>
        </form>
    </ModalShell>
  );
}