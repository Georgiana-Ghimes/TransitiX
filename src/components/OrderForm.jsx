import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { MapPinOff, Save, X } from 'lucide-react';
import { api } from '@/api/client';
import ModalShell from '@/components/ModalShell';
import { notifyError } from '@/lib/notify';
import {
  ORDER_REQUIREMENTS,
  nextOrderNumber,
  orderLocationOptions,
  validateOrder,
} from '@/lib/dispatchUi';

const inputCls = 'w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:border-[#1D4E89] transition-colors';
const errorCls = 'w-full px-3 py-2 text-sm border border-red-300 rounded-lg focus:outline-none focus:border-red-500 transition-colors';
const labelCls = 'block text-xs font-medium text-slate-600 mb-1';

/** Numbers go to the API as numbers or null — never as the empty string a form produces. */
function numberOrNull(value) {
  if (value === '' || value == null) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export default function OrderForm({ order, defaultDate, clients, locations, orders, onClose, onSave }) {
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState({});
  // The suggested number encodes the date, so it must follow the date field — but only
  // until the dispatcher types their own, after which it is theirs and we stop touching it.
  const numberIsOurs = useRef(!order?.order_number);
  const [form, setForm] = useState(() => ({
    order_number: order?.order_number
      || nextOrderNumber(defaultDate, (orders || []).map((o) => o.order_number)),
    client_id: '',
    location_id: '',
    type: 'livrare',
    requested_date: defaultDate || '',
    window_start: '',
    window_end: '',
    service_time_min: 15,
    weight_kg: '',
    volume_mc: '',
    pallets: '',
    requires: [],
    goods_description: '',
    notes: '',
    ...order,
  }));

  const set = (key, value) => {
    if (key === 'order_number') numberIsOurs.current = false;
    setForm((f) => ({ ...f, [key]: value }));
    setErrors((e) => (e[key] ? { ...e, [key]: undefined } : e));
  };

  const setDate = (value) => {
    setForm((f) => ({
      ...f,
      requested_date: value,
      order_number: numberIsOurs.current
        ? nextOrderNumber(value, (orders || []).map((o) => o.order_number))
        : f.order_number,
    }));
    setErrors((e) => (e.requested_date ? { ...e, requested_date: undefined } : e));
  };

  const locationOptions = useMemo(
    () => orderLocationOptions(locations, form.client_id || null),
    [locations, form.client_id]
  );

  // A location belonging to another client must not stay selected after switching client.
  useEffect(() => {
    if (form.location_id && !locationOptions.some((o) => o.id === form.location_id)) {
      set('location_id', '');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [locationOptions]);

  const toggleRequirement = (value) => {
    const current = form.requires || [];
    set('requires', current.includes(value)
      ? current.filter((r) => r !== value)
      : [...current, value]);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    const check = validateOrder(form);
    if (!check.ok) {
      setErrors(check.errors);
      return;
    }
    setSaving(true);
    try {
      const payload = {
        ...form,
        client_id: form.client_id || null,
        window_start: form.window_start || null,
        window_end: form.window_end || null,
        service_time_min: numberOrNull(form.service_time_min) ?? 15,
        weight_kg: numberOrNull(form.weight_kg) ?? 0,
        volume_mc: numberOrNull(form.volume_mc) ?? 0,
        pallets: numberOrNull(form.pallets) ?? 0,
        requires: form.requires || [],
      };
      if (order?.id) await api.entities.Order.update(order.id, payload);
      else await api.entities.Order.create(payload);
      onSave();
    } catch (err) {
      notifyError('Salvarea comenzii a eșuat', err);
    } finally {
      setSaving(false);
    }
  };

  const noLocations = (locations || []).length === 0;

  return (
    <ModalShell onClose={onClose} panelClassName="max-w-2xl" labelledBy="order-form-title">
      <div className="sticky top-0 bg-white border-b border-slate-100 px-6 py-4 flex items-center justify-between z-10">
        <h2 id="order-form-title" className="font-semibold text-[#0A2B4E]">
          {order?.id ? 'Editează comanda' : 'Comandă nouă'}
        </h2>
        <button type="button" onClick={onClose} className="p-1.5 rounded-lg hover:bg-slate-100">
          <X className="w-5 h-5 text-slate-500" />
        </button>
      </div>

      {noLocations ? (
        <div className="p-6 text-center">
          <MapPinOff className="w-9 h-9 mx-auto mb-3 text-slate-300" />
          <p className="text-sm font-medium text-slate-600">Nu există nicio locație</p>
          <p className="text-xs text-slate-400 mt-1 max-w-sm mx-auto">
            O comandă are nevoie de o locație ca să poată intra pe o rută. Adaugă locații din
            adresele clienților, apoi revino aici.
          </p>
          <Link
            to="/locations"
            className="inline-block mt-4 px-4 py-2 text-sm font-medium text-white bg-[#0A2B4E] rounded-lg hover:bg-[#1D4E89]"
          >
            Deschide Locații
          </Link>
        </div>
      ) : (
        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div>
              <label className={labelCls} htmlFor="order-number">Număr comandă *</label>
              <input
                id="order-number"
                className={errors.order_number ? errorCls : inputCls}
                value={form.order_number}
                onChange={(e) => set('order_number', e.target.value)}
              />
              {errors.order_number && <p className="text-[11px] text-red-600 mt-1">{errors.order_number}</p>}
            </div>
            <div>
              <label className={labelCls} htmlFor="order-date">Data *</label>
              <input
                id="order-date"
                type="date"
                className={errors.requested_date ? errorCls : inputCls}
                value={String(form.requested_date || '').slice(0, 10)}
                onChange={(e) => setDate(e.target.value)}
              />
              {errors.requested_date && <p className="text-[11px] text-red-600 mt-1">{errors.requested_date}</p>}
            </div>
            <div>
              <label className={labelCls} htmlFor="order-type">Tip</label>
              <select
                id="order-type"
                className={inputCls}
                value={form.type}
                onChange={(e) => set('type', e.target.value)}
              >
                <option value="livrare">Livrare</option>
                <option value="ridicare">Ridicare</option>
                <option value="schimb">Schimb</option>
              </select>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className={labelCls} htmlFor="order-client">Client</label>
              <select
                id="order-client"
                className={inputCls}
                value={form.client_id || ''}
                onChange={(e) => set('client_id', e.target.value)}
              >
                <option value="">Toți clienții</option>
                {(clients || []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
            <div>
              <label className={labelCls} htmlFor="order-location">Locație *</label>
              <select
                id="order-location"
                className={errors.location_id ? errorCls : inputCls}
                value={form.location_id || ''}
                onChange={(e) => set('location_id', e.target.value)}
              >
                <option value="">Alege locația…</option>
                {locationOptions.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.label}{o.geocoded ? '' : '  (fără coordonate)'}
                  </option>
                ))}
              </select>
              {errors.location_id
                ? <p className="text-[11px] text-red-600 mt-1">{errors.location_id}</p>
                : <p className="text-[11px] text-slate-400 mt-1">
                    O locație fără coordonate se poate planifica, dar nu intră în calculul distanței.
                  </p>}
            </div>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
            <div>
              <label className={labelCls} htmlFor="order-window-start">Fereastră de la</label>
              <input
                id="order-window-start"
                type="time"
                className={inputCls}
                value={String(form.window_start || '').slice(0, 5)}
                onChange={(e) => set('window_start', e.target.value)}
              />
            </div>
            <div>
              <label className={labelCls} htmlFor="order-window-end">până la</label>
              <input
                id="order-window-end"
                type="time"
                className={errors.window_end ? errorCls : inputCls}
                value={String(form.window_end || '').slice(0, 5)}
                onChange={(e) => set('window_end', e.target.value)}
              />
              {errors.window_end && <p className="text-[11px] text-red-600 mt-1">{errors.window_end}</p>}
            </div>
            <div>
              <label className={labelCls} htmlFor="order-service">Timp servire (min)</label>
              <input
                id="order-service"
                type="number"
                min="0"
                className={inputCls}
                value={form.service_time_min}
                onChange={(e) => set('service_time_min', e.target.value)}
              />
            </div>
          </div>

          <div className="grid grid-cols-3 gap-4">
            <div>
              <label className={labelCls} htmlFor="order-weight">Greutate (kg)</label>
              <input
                id="order-weight"
                type="number"
                step="0.01"
                min="0"
                className={errors.weight_kg ? errorCls : inputCls}
                value={form.weight_kg}
                onChange={(e) => set('weight_kg', e.target.value)}
              />
              {errors.weight_kg && <p className="text-[11px] text-red-600 mt-1">{errors.weight_kg}</p>}
            </div>
            <div>
              <label className={labelCls} htmlFor="order-volume">Volum (mc)</label>
              <input
                id="order-volume"
                type="number"
                step="0.01"
                min="0"
                className={errors.volume_mc ? errorCls : inputCls}
                value={form.volume_mc}
                onChange={(e) => set('volume_mc', e.target.value)}
              />
              {errors.volume_mc && <p className="text-[11px] text-red-600 mt-1">{errors.volume_mc}</p>}
            </div>
            <div>
              <label className={labelCls} htmlFor="order-pallets">Paleți</label>
              <input
                id="order-pallets"
                type="number"
                min="0"
                className={errors.pallets ? errorCls : inputCls}
                value={form.pallets}
                onChange={(e) => set('pallets', e.target.value)}
              />
              {errors.pallets && <p className="text-[11px] text-red-600 mt-1">{errors.pallets}</p>}
            </div>
          </div>

          <div>
            <span className={labelCls}>Cerințe vehicul</span>
            <div className="flex flex-wrap gap-1.5">
              {ORDER_REQUIREMENTS.map((requirement) => {
                const active = (form.requires || []).includes(requirement);
                return (
                  <button
                    key={requirement}
                    type="button"
                    aria-pressed={active}
                    onClick={() => toggleRequirement(requirement)}
                    className={`px-3 py-1.5 text-xs font-medium rounded-lg border transition-colors ${
                      active
                        ? 'bg-[#0A2B4E] text-white border-[#0A2B4E]'
                        : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
                    }`}
                  >
                    {requirement}
                  </button>
                );
              })}
            </div>
          </div>

          <div>
            <label className={labelCls} htmlFor="order-goods">Descriere marfă</label>
            <input
              id="order-goods"
              className={inputCls}
              value={form.goods_description || ''}
              onChange={(e) => set('goods_description', e.target.value)}
            />
          </div>

          <div>
            <label className={labelCls} htmlFor="order-notes">Note</label>
            <textarea
              id="order-notes"
              rows={2}
              className={inputCls}
              value={form.notes || ''}
              onChange={(e) => set('notes', e.target.value)}
            />
          </div>

          <div className="flex gap-3 pt-2 border-t border-slate-100">
            <button
              type="submit"
              disabled={saving}
              className="flex items-center gap-2 px-5 py-2.5 text-sm font-medium text-white bg-[#0A2B4E] rounded-lg hover:bg-[#1D4E89] disabled:opacity-50 transition-colors"
            >
              <Save className="w-4 h-4" /> {saving ? 'Se salvează...' : 'Salvează'}
            </button>
            <button
              type="button"
              onClick={onClose}
              className="px-5 py-2.5 text-sm font-medium text-slate-600 bg-white border border-slate-200 rounded-lg hover:bg-slate-50 transition-colors"
            >
              Anulează
            </button>
          </div>
        </form>
      )}
    </ModalShell>
  );
}
