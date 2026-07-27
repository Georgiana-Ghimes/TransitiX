import React, { useState } from 'react';
import { base44 } from '@/api/base44Client';
import { X, Save } from 'lucide-react';

export default function VehicleForm({ vehicle, onClose, onSave }) {
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    plate: '', brand: '', model: '', year: '', capacity_kg: '', capacity_mc: '',
    fuel_consumption: '', fuel_type: 'diesel', chassis_number: '', engine_number: '',
    mileage: '', itp_number: '', itp_expiry: '', rca_number: '', rca_expiry: '',
    rovinieta_number: '', rovinieta_expiry: '', casco_number: '', casco_expiry: '',
    status: 'available', is_active: true,
    ...vehicle,
  });

  const set = (k, val) => setForm(f => ({ ...f, [k]: val }));

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      const data = {
        ...form,
        year: form.year ? Number(form.year) : null,
        capacity_kg: form.capacity_kg ? Number(form.capacity_kg) : null,
        capacity_mc: form.capacity_mc ? Number(form.capacity_mc) : null,
        fuel_consumption: form.fuel_consumption ? Number(form.fuel_consumption) : null,
        mileage: form.mileage ? Number(form.mileage) : 0,
      };
      if (vehicle?.id) await base44.entities.Vehicle.update(vehicle.id, data);
      else await base44.entities.Vehicle.create(data);
      onSave();
    } catch (e) {
      console.error(e);
      alert('Eroare la salvare: ' + (e.message || 'unknown'));
    } finally { setSaving(false); }
  };

  const inputCls = "w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:border-[#1D4E89] transition-colors";
  const labelCls = "block text-xs font-medium text-slate-600 mb-1";

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-2xl max-h-[90vh] overflow-y-auto">
        <div className="sticky top-0 bg-white border-b border-slate-100 px-6 py-4 flex items-center justify-between z-10">
          <h2 className="font-semibold text-[#0A2B4E]">{vehicle ? 'Editează vehicul' : 'Vehicul nou'}</h2>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-slate-100"><X className="w-5 h-5 text-slate-500" /></button>
        </div>
        <form onSubmit={handleSubmit} className="p-6 space-y-5">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div><label className={labelCls}>Număr înmatriculare *</label><input required className={inputCls} value={form.plate} onChange={e => set('plate', e.target.value)} /></div>
            <div><label className={labelCls}>Status</label><select className={inputCls} value={form.status} onChange={e => set('status', e.target.value)}><option value="available">Disponibil</option><option value="in_trip">În cursă</option><option value="maintenance">Mentenanță</option><option value="inactive">Inactiv</option></select></div>
            <div><label className={labelCls}>Marcă *</label><input required className={inputCls} value={form.brand} onChange={e => set('brand', e.target.value)} /></div>
            <div><label className={labelCls}>Model *</label><input required className={inputCls} value={form.model} onChange={e => set('model', e.target.value)} /></div>
            <div><label className={labelCls}>An fabricație</label><input type="number" className={inputCls} value={form.year} onChange={e => set('year', e.target.value)} /></div>
            <div><label className={labelCls}>Tip combustibil</label><select className={inputCls} value={form.fuel_type} onChange={e => set('fuel_type', e.target.value)}><option value="diesel">Diesel</option><option value="gasoline">Benzină</option><option value="electric">Electric</option><option value="hybrid">Hibrid</option></select></div>
            <div><label className={labelCls}>Capacitate (kg)</label><input type="number" className={inputCls} value={form.capacity_kg} onChange={e => set('capacity_kg', e.target.value)} /></div>
            <div><label className={labelCls}>Capacitate (mc)</label><input type="number" className={inputCls} value={form.capacity_mc} onChange={e => set('capacity_mc', e.target.value)} /></div>
            <div><label className={labelCls}>Consum (l/100km)</label><input type="number" step="0.01" className={inputCls} value={form.fuel_consumption} onChange={e => set('fuel_consumption', e.target.value)} /></div>
            <div><label className={labelCls}>Kilometraj</label><input type="number" className={inputCls} value={form.mileage} onChange={e => set('mileage', e.target.value)} /></div>
            <div><label className={labelCls}>Număr șasiu</label><input className={inputCls} value={form.chassis_number} onChange={e => set('chassis_number', e.target.value)} /></div>
            <div><label className={labelCls}>Număr motor</label><input className={inputCls} value={form.engine_number} onChange={e => set('engine_number', e.target.value)} /></div>
          </div>

          <div className="space-y-3">
            <h3 className="text-sm font-semibold text-[#0A2B4E] border-l-2 border-[#F5A623] pl-2">Documente</h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div><label className={labelCls}>Număr ITP</label><input className={inputCls} value={form.itp_number} onChange={e => set('itp_number', e.target.value)} /></div>
              <div><label className={labelCls}>Expirare ITP</label><input type="date" className={inputCls} value={form.itp_expiry || ''} onChange={e => set('itp_expiry', e.target.value)} /></div>
              <div><label className={labelCls}>Număr RCA</label><input className={inputCls} value={form.rca_number} onChange={e => set('rca_number', e.target.value)} /></div>
              <div><label className={labelCls}>Expirare RCA</label><input type="date" className={inputCls} value={form.rca_expiry || ''} onChange={e => set('rca_expiry', e.target.value)} /></div>
              <div><label className={labelCls}>Număr rovinietă</label><input className={inputCls} value={form.rovinieta_number} onChange={e => set('rovinieta_number', e.target.value)} /></div>
              <div><label className={labelCls}>Expirare rovinietă</label><input type="date" className={inputCls} value={form.rovinieta_expiry || ''} onChange={e => set('rovinieta_expiry', e.target.value)} /></div>
              <div><label className={labelCls}>Număr CASCO</label><input className={inputCls} value={form.casco_number} onChange={e => set('casco_number', e.target.value)} /></div>
              <div><label className={labelCls}>Expirare CASCO</label><input type="date" className={inputCls} value={form.casco_expiry || ''} onChange={e => set('casco_expiry', e.target.value)} /></div>
            </div>
          </div>

          <div className="flex gap-3 pt-2 border-t border-slate-100">
            <button type="submit" disabled={saving} className="flex items-center gap-2 px-5 py-2.5 text-sm font-medium text-white bg-[#0A2B4E] rounded-lg hover:bg-[#1D4E89] disabled:opacity-50 transition-colors">
              <Save className="w-4 h-4" /> {saving ? 'Se salvează...' : 'Salvează'}
            </button>
            <button type="button" onClick={onClose} className="px-5 py-2.5 text-sm font-medium text-slate-600 bg-white border border-slate-200 rounded-lg hover:bg-slate-50 transition-colors">Anulează</button>
          </div>
        </form>
      </div>
    </div>
  );
}