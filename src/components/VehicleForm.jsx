import React, { useState } from 'react';
import { api } from '@/api/client';
import { X, Save } from 'lucide-react';
import ModalShell from '@/components/ModalShell';
import { FieldError, FormErrorBanner, fieldInputClass } from '@/components/FormFeedback';
import { friendlyErrorMessage } from '@/lib/notify';
import { formatCapabilities, parseCapabilities } from '@/lib/planningUi';

const INT_MAX = 2_147_483_647;
const YEAR_MIN = 1950;
const YEAR_MAX = new Date().getFullYear() + 1;

function parseOptionalNumber(value) {
  if (value === '' || value == null) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : NaN;
}

function validateVehicle(form) {
  const errors = {};
  const year = parseOptionalNumber(form.year);
  const capacityKg = parseOptionalNumber(form.capacity_kg);
  const capacityMc = parseOptionalNumber(form.capacity_mc);
  const capacityPallets = parseOptionalNumber(form.capacity_pallets);
  const costPerKm = parseOptionalNumber(form.cost_per_km);
  const costPerHour = parseOptionalNumber(form.cost_per_hour);
  const consumption = parseOptionalNumber(form.fuel_consumption);
  const mileage = parseOptionalNumber(form.mileage);

  if (!String(form.plate || '').trim()) errors.plate = 'Numărul de înmatriculare este obligatoriu.';
  if (!String(form.brand || '').trim()) errors.brand = 'Marca este obligatorie.';
  if (!String(form.model || '').trim()) errors.model = 'Modelul este obligatoriu.';

  if (form.year !== '' && form.year != null) {
    if (!Number.isFinite(year) || !Number.isInteger(year)) errors.year = 'An invalid.';
    else if (year < YEAR_MIN || year > YEAR_MAX) errors.year = `An între ${YEAR_MIN} și ${YEAR_MAX}.`;
  }

  if (form.capacity_kg !== '' && form.capacity_kg != null) {
    if (!Number.isFinite(capacityKg) || capacityKg < 0) errors.capacity_kg = 'Capacitate invalidă (min. 0).';
    else if (capacityKg > INT_MAX) errors.capacity_kg = `Prea mare (max. ${INT_MAX.toLocaleString('ro-RO')} kg).`;
  }

  if (form.capacity_mc !== '' && form.capacity_mc != null) {
    if (!Number.isFinite(capacityMc) || capacityMc < 0) errors.capacity_mc = 'Capacitate invalidă (min. 0).';
    else if (capacityMc > INT_MAX) errors.capacity_mc = `Prea mare (max. ${INT_MAX.toLocaleString('ro-RO')} mc).`;
  }

  if (form.capacity_pallets !== '' && form.capacity_pallets != null) {
    if (!Number.isFinite(capacityPallets) || capacityPallets < 0 || !Number.isInteger(capacityPallets)) {
      errors.capacity_pallets = 'Număr invalid de paleți (min. 0).';
    }
  }

  if (form.cost_per_km !== '' && form.cost_per_km != null) {
    if (!Number.isFinite(costPerKm) || costPerKm < 0) errors.cost_per_km = 'Cost invalid (min. 0).';
  }
  if (form.cost_per_hour !== '' && form.cost_per_hour != null) {
    if (!Number.isFinite(costPerHour) || costPerHour < 0) errors.cost_per_hour = 'Cost invalid (min. 0).';
  }

  if (form.fuel_consumption !== '' && form.fuel_consumption != null) {
    if (!Number.isFinite(consumption) || consumption < 0) errors.fuel_consumption = 'Consum invalid (min. 0).';
    else if (consumption > 999.99) errors.fuel_consumption = 'Consum max. 999.99 l/100km.';
  }

  if (form.mileage !== '' && form.mileage != null) {
    if (!Number.isFinite(mileage) || mileage < 0) errors.mileage = 'Kilometraj invalid (min. 0).';
    else if (mileage > INT_MAX) errors.mileage = `Prea mare (max. ${INT_MAX.toLocaleString('ro-RO')} km).`;
  }

  return errors;
}

export default function VehicleForm({ vehicle, onClose, onSave }) {
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState({});
  const [formError, setFormError] = useState('');
  const [form, setForm] = useState({
    plate: '', brand: '', model: '', year: '', capacity_kg: '', capacity_mc: '',
    capacity_pallets: '', capabilities: '', cost_per_km: '', cost_per_hour: '',
    cargo_length_m: '', cargo_width_m: '', cargo_height_m: '',
    axle_front_m: '', axle_rear_m: '', axle_front_max_kg: '', axle_rear_max_kg: '',
    fuel_price_per_l: '', wage_per_hour: '', toll_per_km: '',
    depreciation_per_km: '', maintenance_per_km: '',
    fuel_consumption: '', fuel_type: 'diesel', chassis_number: '', engine_number: '',
    mileage: '', itp_number: '', itp_expiry: '', rca_number: '', rca_expiry: '',
    rovinieta_number: '', rovinieta_expiry: '', casco_number: '', casco_expiry: '',
    status: 'available', is_active: true,
    ...vehicle,
    capabilities: formatCapabilities(vehicle?.capabilities) || '',
  });

  const set = (k, val) => {
    setForm((f) => ({ ...f, [k]: val }));
    if (errors[k]) setErrors((e) => ({ ...e, [k]: undefined }));
    if (formError) setFormError('');
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    const nextErrors = validateVehicle(form);
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) {
      setFormError('Corectează câmpurile evidențiate înainte de salvare.');
      const firstKey = Object.keys(nextErrors)[0];
      document.getElementById(`vehicle-${firstKey}`)?.focus();
      return;
    }

    setSaving(true);
    setFormError('');
    try {
      const data = {
        ...form,
        year: parseOptionalNumber(form.year),
        capacity_kg: parseOptionalNumber(form.capacity_kg),
        capacity_mc: parseOptionalNumber(form.capacity_mc),
        capacity_pallets: parseOptionalNumber(form.capacity_pallets),
        cost_per_km: parseOptionalNumber(form.cost_per_km),
        cost_per_hour: parseOptionalNumber(form.cost_per_hour),
        cargo_length_m: parseOptionalNumber(form.cargo_length_m),
        cargo_width_m: parseOptionalNumber(form.cargo_width_m),
        cargo_height_m: parseOptionalNumber(form.cargo_height_m),
        axle_front_m: parseOptionalNumber(form.axle_front_m),
        axle_rear_m: parseOptionalNumber(form.axle_rear_m),
        axle_front_max_kg: parseOptionalNumber(form.axle_front_max_kg),
        axle_rear_max_kg: parseOptionalNumber(form.axle_rear_max_kg),
        fuel_price_per_l: parseOptionalNumber(form.fuel_price_per_l),
        wage_per_hour: parseOptionalNumber(form.wage_per_hour),
        toll_per_km: parseOptionalNumber(form.toll_per_km),
        depreciation_per_km: parseOptionalNumber(form.depreciation_per_km),
        maintenance_per_km: parseOptionalNumber(form.maintenance_per_km),
        capabilities: parseCapabilities(form.capabilities),
        fuel_consumption: parseOptionalNumber(form.fuel_consumption),
        mileage: parseOptionalNumber(form.mileage) ?? 0,
      };
      if (vehicle?.id) await api.entities.Vehicle.update(vehicle.id, data);
      else await api.entities.Vehicle.create(data);
      onSave();
    } catch (err) {
      console.error(err);
      const msg = friendlyErrorMessage(err);
      if (/duplicate|unic|înmatriculare/i.test(msg)) {
        setErrors({ plate: 'Acest număr de înmatriculare există deja.' });
        document.getElementById('vehicle-plate')?.focus();
      }
      setFormError(msg);
    } finally {
      setSaving(false);
    }
  };

  const inputCls = 'w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:border-[#1D4E89] transition-colors';
  const labelCls = 'block text-xs font-medium text-slate-600 mb-1';

  const field = (id, props) => (
    <input
      id={`vehicle-${id}`}
      aria-invalid={Boolean(errors[id])}
      aria-describedby={errors[id] ? `vehicle-${id}-error` : undefined}
      className={fieldInputClass(inputCls, errors[id])}
      {...props}
    />
  );

  return (
    <ModalShell onClose={onClose} panelClassName="max-w-2xl" labelledBy="vehicle-form-title">
      <div className="sticky top-0 bg-white border-b border-slate-100 px-6 py-4 flex items-center justify-between z-10">
        <h2 id="vehicle-form-title" className="font-semibold text-[#0A2B4E]">{vehicle ? 'Editează vehicul' : 'Vehicul nou'}</h2>
        <button type="button" onClick={onClose} className="p-1.5 rounded-lg hover:bg-slate-100"><X className="w-5 h-5 text-slate-500" /></button>
      </div>
      <form onSubmit={handleSubmit} className="p-6 space-y-5" noValidate>
        <FormErrorBanner message={formError} />
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className={labelCls} htmlFor="vehicle-plate">Număr înmatriculare *</label>
            {field('plate', { required: true, value: form.plate, onChange: (e) => set('plate', e.target.value) })}
            <FieldError id="vehicle-plate-error" message={errors.plate} />
          </div>
          <div>
            <label className={labelCls} htmlFor="vehicle-status">Status</label>
            <select id="vehicle-status" className={inputCls} value={form.status} onChange={(e) => set('status', e.target.value)}>
              <option value="available">Disponibil</option>
              <option value="in_trip">În cursă</option>
              <option value="maintenance">Mentenanță</option>
              <option value="inactive">Inactiv</option>
            </select>
          </div>
          <div>
            <label className={labelCls} htmlFor="vehicle-brand">Marcă *</label>
            {field('brand', { required: true, value: form.brand, onChange: (e) => set('brand', e.target.value) })}
            <FieldError id="vehicle-brand-error" message={errors.brand} />
          </div>
          <div>
            <label className={labelCls} htmlFor="vehicle-model">Model *</label>
            {field('model', { required: true, value: form.model, onChange: (e) => set('model', e.target.value) })}
            <FieldError id="vehicle-model-error" message={errors.model} />
          </div>
          <div>
            <label className={labelCls} htmlFor="vehicle-year">An fabricație</label>
            {field('year', { type: 'number', min: YEAR_MIN, max: YEAR_MAX, value: form.year, onChange: (e) => set('year', e.target.value) })}
            <FieldError id="vehicle-year-error" message={errors.year} />
          </div>
          <div>
            <label className={labelCls} htmlFor="vehicle-fuel_type">Tip combustibil</label>
            <select id="vehicle-fuel_type" className={inputCls} value={form.fuel_type} onChange={(e) => set('fuel_type', e.target.value)}>
              <option value="diesel">Diesel</option>
              <option value="gasoline">Benzină</option>
              <option value="electric">Electric</option>
              <option value="hybrid">Hibrid</option>
            </select>
          </div>
          <div>
            <label className={labelCls} htmlFor="vehicle-capacity_kg">Capacitate (kg)</label>
            {field('capacity_kg', { type: 'number', min: 0, max: INT_MAX, value: form.capacity_kg, onChange: (e) => set('capacity_kg', e.target.value) })}
            <FieldError id="vehicle-capacity_kg-error" message={errors.capacity_kg} />
          </div>
          <div>
            <label className={labelCls} htmlFor="vehicle-capacity_mc">Capacitate (mc)</label>
            {field('capacity_mc', { type: 'number', min: 0, max: INT_MAX, value: form.capacity_mc, onChange: (e) => set('capacity_mc', e.target.value) })}
            <FieldError id="vehicle-capacity_mc-error" message={errors.capacity_mc} />
          </div>
          <div>
            <label className={labelCls} htmlFor="vehicle-capacity_pallets">Capacitate (paleți)</label>
            {field('capacity_pallets', { type: 'number', min: 0, value: form.capacity_pallets ?? '', onChange: (e) => set('capacity_pallets', e.target.value) })}
            <FieldError id="vehicle-capacity_pallets-error" message={errors.capacity_pallets} />
          </div>
          <div className="sm:col-span-2">
            <label className={labelCls} htmlFor="vehicle-capabilities">Dotări (ADR, frigo, lift…)</label>
            {field('capabilities', {
              value: form.capabilities ?? '',
              onChange: (e) => set('capabilities', e.target.value),
              placeholder: 'ADR, frigo, lift-hidraulic',
            })}
            <p className="text-[11px] text-slate-400 mt-1">Separate prin virgulă — trebuie să acopere cerințele comenzilor.</p>
          </div>
          <div className="sm:col-span-2 border-t border-slate-100 pt-3">
            <p className="text-xs font-medium text-slate-500 mb-2">Spațiu marfă (plan încărcare)</p>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div>
                <label className={labelCls} htmlFor="vehicle-cargo_length_m">Lungime (m)</label>
                {field('cargo_length_m', { type: 'number', min: 0, step: '0.01', value: form.cargo_length_m ?? '', onChange: (e) => set('cargo_length_m', e.target.value) })}
              </div>
              <div>
                <label className={labelCls} htmlFor="vehicle-cargo_width_m">Lățime (m)</label>
                {field('cargo_width_m', { type: 'number', min: 0, step: '0.01', value: form.cargo_width_m ?? '', onChange: (e) => set('cargo_width_m', e.target.value) })}
              </div>
              <div>
                <label className={labelCls} htmlFor="vehicle-cargo_height_m">Înălțime (m)</label>
                {field('cargo_height_m', { type: 'number', min: 0, step: '0.01', value: form.cargo_height_m ?? '', onChange: (e) => set('cargo_height_m', e.target.value) })}
              </div>
              <div>
                <label className={labelCls} htmlFor="vehicle-axle_front_m">Axa față (m de la nas)</label>
                {field('axle_front_m', { type: 'number', min: 0, step: '0.01', value: form.axle_front_m ?? '', onChange: (e) => set('axle_front_m', e.target.value) })}
              </div>
              <div>
                <label className={labelCls} htmlFor="vehicle-axle_rear_m">Axa spate (m)</label>
                {field('axle_rear_m', { type: 'number', min: 0, step: '0.01', value: form.axle_rear_m ?? '', onChange: (e) => set('axle_rear_m', e.target.value) })}
              </div>
              <div>
                <label className={labelCls} htmlFor="vehicle-axle_front_max_kg">Limită față (kg)</label>
                {field('axle_front_max_kg', { type: 'number', min: 0, value: form.axle_front_max_kg ?? '', onChange: (e) => set('axle_front_max_kg', e.target.value) })}
              </div>
              <div>
                <label className={labelCls} htmlFor="vehicle-axle_rear_max_kg">Limită spate (kg)</label>
                {field('axle_rear_max_kg', { type: 'number', min: 0, value: form.axle_rear_max_kg ?? '', onChange: (e) => set('axle_rear_max_kg', e.target.value) })}
              </div>
            </div>
            <p className="text-[11px] text-slate-400 mt-1">Gol = remorcă EU standard 13,6 × 2,45 × 2,7 m.</p>
          </div>
          <div>
            <label className={labelCls} htmlFor="vehicle-cost_per_km">Cost pe km (lei)</label>
            {field('cost_per_km', { type: 'number', min: 0, step: '0.01', value: form.cost_per_km ?? '', onChange: (e) => set('cost_per_km', e.target.value) })}
            <FieldError id="vehicle-cost_per_km-error" message={errors.cost_per_km} />
          </div>
          <div>
            <label className={labelCls} htmlFor="vehicle-cost_per_hour">Cost pe oră (lei)</label>
            {field('cost_per_hour', { type: 'number', min: 0, step: '0.01', value: form.cost_per_hour ?? '', onChange: (e) => set('cost_per_hour', e.target.value) })}
            <FieldError id="vehicle-cost_per_hour-error" message={errors.cost_per_hour} />
          </div>
          <div>
            <label className={labelCls} htmlFor="vehicle-fuel_consumption">Consum (l/100km)</label>
            {field('fuel_consumption', { type: 'number', step: '0.01', min: 0, max: 999.99, value: form.fuel_consumption, onChange: (e) => set('fuel_consumption', e.target.value) })}
            <FieldError id="vehicle-fuel_consumption-error" message={errors.fuel_consumption} />
          </div>
          <div className="sm:col-span-2">
            <h4 className="text-xs font-semibold text-slate-500 mb-2">Cost detaliat (cockpit)</h4>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              <div>
                <label className={labelCls} htmlFor="vehicle-fuel_price_per_l">Preț combustibil (lei/l)</label>
                {field('fuel_price_per_l', { type: 'number', min: 0, step: '0.01', value: form.fuel_price_per_l ?? '', onChange: (e) => set('fuel_price_per_l', e.target.value) })}
              </div>
              <div>
                <label className={labelCls} htmlFor="vehicle-wage_per_hour">Salariu șofer (lei/h)</label>
                {field('wage_per_hour', { type: 'number', min: 0, step: '0.01', value: form.wage_per_hour ?? '', onChange: (e) => set('wage_per_hour', e.target.value) })}
              </div>
              <div>
                <label className={labelCls} htmlFor="vehicle-toll_per_km">Taxe drum (lei/km)</label>
                {field('toll_per_km', { type: 'number', min: 0, step: '0.01', value: form.toll_per_km ?? '', onChange: (e) => set('toll_per_km', e.target.value) })}
              </div>
              <div>
                <label className={labelCls} htmlFor="vehicle-depreciation_per_km">Amortizare (lei/km)</label>
                {field('depreciation_per_km', { type: 'number', min: 0, step: '0.01', value: form.depreciation_per_km ?? '', onChange: (e) => set('depreciation_per_km', e.target.value) })}
              </div>
              <div>
                <label className={labelCls} htmlFor="vehicle-maintenance_per_km">Întreținere (lei/km)</label>
                {field('maintenance_per_km', { type: 'number', min: 0, step: '0.01', value: form.maintenance_per_km ?? '', onChange: (e) => set('maintenance_per_km', e.target.value) })}
              </div>
            </div>
            <p className="text-[11px] text-slate-400 mt-1">Gol = folosește default-urile firmei. Fără costuri, cockpit-ul lasă totalul gol (nu inventează).</p>
          </div>
          <div>
            <label className={labelCls} htmlFor="vehicle-mileage">Kilometraj</label>
            {field('mileage', { type: 'number', min: 0, max: INT_MAX, value: form.mileage, onChange: (e) => set('mileage', e.target.value) })}
            <FieldError id="vehicle-mileage-error" message={errors.mileage} />
          </div>
          <div>
            <label className={labelCls} htmlFor="vehicle-chassis_number">Număr șasiu</label>
            {field('chassis_number', { value: form.chassis_number, onChange: (e) => set('chassis_number', e.target.value) })}
          </div>
          <div>
            <label className={labelCls} htmlFor="vehicle-engine_number">Număr motor</label>
            {field('engine_number', { value: form.engine_number, onChange: (e) => set('engine_number', e.target.value) })}
          </div>
        </div>

        <div className="space-y-3">
          <h3 className="text-sm font-semibold text-[#0A2B4E] border-l-2 border-[#F5A623] pl-2">Documente</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div><label className={labelCls}>Număr ITP</label><input className={inputCls} value={form.itp_number} onChange={(e) => set('itp_number', e.target.value)} /></div>
            <div><label className={labelCls}>Expirare ITP</label><input type="date" className={inputCls} value={form.itp_expiry || ''} onChange={(e) => set('itp_expiry', e.target.value)} /></div>
            <div><label className={labelCls}>Număr RCA</label><input className={inputCls} value={form.rca_number} onChange={(e) => set('rca_number', e.target.value)} /></div>
            <div><label className={labelCls}>Expirare RCA</label><input type="date" className={inputCls} value={form.rca_expiry || ''} onChange={(e) => set('rca_expiry', e.target.value)} /></div>
            <div><label className={labelCls}>Număr rovinietă</label><input className={inputCls} value={form.rovinieta_number} onChange={(e) => set('rovinieta_number', e.target.value)} /></div>
            <div><label className={labelCls}>Expirare rovinietă</label><input type="date" className={inputCls} value={form.rovinieta_expiry || ''} onChange={(e) => set('rovinieta_expiry', e.target.value)} /></div>
            <div><label className={labelCls}>Număr CASCO</label><input className={inputCls} value={form.casco_number} onChange={(e) => set('casco_number', e.target.value)} /></div>
            <div><label className={labelCls}>Expirare CASCO</label><input type="date" className={inputCls} value={form.casco_expiry || ''} onChange={(e) => set('casco_expiry', e.target.value)} /></div>
          </div>
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
