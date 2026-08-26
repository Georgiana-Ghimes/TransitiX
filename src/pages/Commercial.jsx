import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle, Check, Loader2, MapPin, Pencil, Plus, RefreshCw, Trash2, Upload,
} from 'lucide-react';
import { api } from '@/api/client';
import { notifyError, notifySuccess } from '@/lib/notify';
import ModalShell from '@/components/ModalShell';
import {
  APPLIES_PER,
  VEHICLE_CLASSES,
  ZONE_KINDS,
  bracketLabel,
  formatAmount,
  groupTariffs,
  isInForce,
  parseAmount,
  validateSurchargeRate,
  validateTariff,
  validateZoneRate,
  validityLabel,
} from '@/lib/commercial';

const TABS = [
  { id: 'tarife', label: 'Tarife contractuale' },
  { id: 'zone', label: 'Zone și taxe' },
  { id: 'taxe', label: 'Taxe suplimentare' },
  { id: 'coduri', label: 'Coduri observații' },
  { id: 'garaj', label: 'Garaj' },
];

const inputCls = 'w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none '
  + 'focus:border-[#1D4E89] transition-colors';
const labelCls = 'block text-xs font-medium text-slate-600 mb-1';
const btnPrimary = 'px-3 py-2 text-sm rounded-lg bg-[#1D4E89] text-white hover:bg-[#0A2B4E] '
  + 'disabled:opacity-40 inline-flex items-center gap-1.5 min-h-[38px]';
const btnGhost = 'px-3 py-2 text-sm rounded-lg border border-slate-200 text-slate-600 '
  + 'hover:bg-slate-50 inline-flex items-center gap-1.5 min-h-[38px]';

function Field({ label, hint, error, children }) {
  return (
    <div>
      <span className={labelCls}>{label}</span>
      {children}
      {error ? <p className="text-[11px] text-red-600 mt-1">{error}</p> : null}
      {!error && hint ? <p className="text-[11px] text-slate-400 mt-1">{hint}</p> : null}
    </div>
  );
}

function InForceBadge({ row }) {
  if (!isInForce(row)) return null;
  return (
    <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200">
      în vigoare
    </span>
  );
}

function Empty({ children }) {
  return <p className="text-sm text-slate-500 px-4 py-6 text-center">{children}</p>;
}

// -------------------------------------------------------------------- tarife

function TariffForm({ contracts, classes, initial, onClose, onSaved }) {
  const [form, setForm] = useState({
    contract_id: '', vehicle_class: '', trip_rate: '', km_rate: '', min_km: '',
    currency: 'RON', valid_from: '', valid_to: '', notes: '', ...initial,
  });
  const [errors, setErrors] = useState({});
  const [saving, setSaving] = useState(false);
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  const submit = async (e) => {
    e.preventDefault();
    const next = validateTariff(form);
    setErrors(next);
    if (Object.keys(next).length) return;
    setSaving(true);
    try {
      const payload = {
        contract_id: form.contract_id,
        vehicle_class: form.vehicle_class.trim(),
        trip_rate: parseAmount(form.trip_rate),
        km_rate: parseAmount(form.km_rate),
        min_km: parseAmount(form.min_km),
        currency: form.currency || 'RON',
        valid_from: form.valid_from,
        valid_to: form.valid_to || null,
        notes: form.notes || null,
      };
      if (initial?.id) await api.entities.ContractTariff.update(initial.id, payload);
      else await api.entities.ContractTariff.create(payload);
      notifySuccess(initial?.id ? 'Tarif actualizat' : 'Tarif adăugat');
      onSaved();
    } catch (err) {
      notifyError('Salvarea a eșuat', err);
    } finally {
      setSaving(false);
    }
  };

  return (
    <ModalShell open onClose={onClose} title={initial?.id ? 'Editează tariful' : 'Tarif nou'}>
      <form onSubmit={submit} className="p-5 space-y-4">
        <div className="rounded-lg bg-amber-50 border border-amber-200 px-3 py-2 text-[12px] text-amber-800">
          Un tarif nu se editează în loc — se închide și se adaugă altul de la data actului
          adițional. Rapoartele vechi trebuie să rămână recalculabile cu tariful de atunci.
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Contract" error={errors.contract_id}>
            <select className={inputCls} value={form.contract_id} onChange={(e) => set('contract_id', e.target.value)}>
              <option value="">Alege…</option>
              {contracts.map((c) => (
                <option key={c.id} value={c.id}>{c.code} — {c.name || 'fără nume'}</option>
              ))}
            </select>
          </Field>
          <Field
            label="Clasă vehicul"
            hint="Banda comercială, nu MMA"
            error={errors.vehicle_class}
          >
            <input
              className={inputCls}
              list="tariff-classes"
              value={form.vehicle_class}
              onChange={(e) => set('vehicle_class', e.target.value)}
              placeholder="10t"
            />
            <datalist id="tariff-classes">
              {[...new Set([...classes, ...VEHICLE_CLASSES])].map((c) => <option key={c} value={c} />)}
            </datalist>
          </Field>
          <Field label="Tarif pe cursă (lei)" error={errors.trip_rate}>
            <input className={inputCls} value={form.trip_rate} onChange={(e) => set('trip_rate', e.target.value)} placeholder="500" />
          </Field>
          <Field label="Tarif pe km (lei)" error={errors.km_rate}>
            <input className={inputCls} value={form.km_rate} onChange={(e) => set('km_rate', e.target.value)} placeholder="1,95" />
          </Field>
          <Field label="Km minimi facturabili" hint="Opțional">
            <input className={inputCls} value={form.min_km ?? ''} onChange={(e) => set('min_km', e.target.value)} />
          </Field>
          <Field label="Monedă">
            <input className={inputCls} value={form.currency} onChange={(e) => set('currency', e.target.value)} />
          </Field>
          <Field label="Valabil de la" error={errors.valid_from}>
            <input type="date" className={inputCls} value={form.valid_from || ''} onChange={(e) => set('valid_from', e.target.value)} />
          </Field>
          <Field label="Valabil până la" hint="Gol = deschis" error={errors.valid_to}>
            <input type="date" className={inputCls} value={form.valid_to || ''} onChange={(e) => set('valid_to', e.target.value)} />
          </Field>
        </div>
        <Field label="Notă (act adițional, nr. anexă)">
          <input className={inputCls} value={form.notes || ''} onChange={(e) => set('notes', e.target.value)} />
        </Field>
        <div className="flex justify-end gap-2 pt-2">
          <button type="button" className={btnGhost} onClick={onClose}>Anulează</button>
          <button type="submit" className={btnPrimary} disabled={saving}>
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
            Salvează
          </button>
        </div>
      </form>
    </ModalShell>
  );
}

function TariffsTab({ data, reload }) {
  const [editing, setEditing] = useState(null);
  const [contractId, setContractId] = useState('');

  const contract = data.contracts.find((c) => c.id === contractId) ?? data.contracts[0] ?? null;
  const rows = useMemo(
    () => data.tariffs.filter((t) => t.contract_id === contract?.id),
    [data.tariffs, contract]
  );
  const groups = useMemo(() => groupTariffs(rows), [rows]);

  const remove = async (row) => {
    if (!window.confirm(`Ștergi tariful ${row.vehicle_class} din ${validityLabel(row)}?\n\nRapoartele deja exportate nu se schimbă, dar o recalculare a unei curse din perioada asta nu va mai găsi tarif.`)) return;
    try {
      await api.entities.ContractTariff.delete(row.id);
      notifySuccess('Tarif șters');
      reload();
    } catch (err) {
      notifyError('Ștergerea a eșuat', err);
    }
  };

  if (!data.contracts.length) {
    return (
      <Empty>
        Nu există niciun contract. Adaugă întâi un contract pe ecranul Clienți, apoi revino aici
        pentru tarife.
      </Empty>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-[240px]">
          <span className={labelCls}>Contract</span>
          <select
            className={inputCls}
            value={contract?.id ?? ''}
            onChange={(e) => setContractId(e.target.value)}
          >
            {data.contracts.map((c) => (
              <option key={c.id} value={c.id}>
                {c.code} — {c.name || 'fără nume'} ({c.tariff_count} tarife)
              </option>
            ))}
          </select>
        </div>
        <button type="button" className={btnPrimary} onClick={() => setEditing({ contract_id: contract?.id })}>
          <Plus className="w-4 h-4" /> Tarif nou
        </button>
      </div>

      {contract?.classes_without_current_tariff?.length ? (
        <div className="flex gap-2 items-start rounded-lg border border-red-200 bg-red-50 px-3 py-2">
          <AlertTriangle className="w-4 h-4 text-red-600 shrink-0 mt-0.5" />
          <p className="text-sm text-red-800">
            <span className="font-medium">
              Fără tarif valabil azi: {contract.classes_without_current_tariff.join(', ')}.
            </span>{' '}
            Cursele din aceste clase se vor calcula fără linia de transport.
          </p>
        </div>
      ) : null}

      {contract?.overlaps?.length ? (
        <div className="flex gap-2 items-start rounded-lg border border-amber-200 bg-amber-50 px-3 py-2">
          <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
          <p className="text-sm text-amber-800">
            Perioade suprapuse pe {[...new Set(contract.overlaps.map((o) => o.vehicle_class))].join(', ')}.
            Se aplică cel mai nou — de obicei înseamnă un „valabil până la” uitat.
          </p>
        </div>
      ) : null}

      {groups.length === 0 ? (
        <Empty>Contractul nu are niciun tarif. Adaugă unul ca să se poată calcula TPO-ul.</Empty>
      ) : groups.map((group) => (
        <section key={group.vehicle_class} className="bg-white rounded-xl border border-slate-200 overflow-hidden">
          <div className="px-4 py-2.5 bg-slate-50 border-b border-slate-200 flex items-center gap-2">
            <span className="font-semibold text-sm text-slate-800">{group.vehicle_class}</span>
            <span className="text-xs text-slate-500">{group.rows.length} perioade</span>
          </div>
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="text-[11px] uppercase text-slate-500">
                  <th className="text-left px-4 py-2 font-medium">Valabilitate</th>
                  <th className="text-right px-4 py-2 font-medium">Tarif cursă</th>
                  <th className="text-right px-4 py-2 font-medium">Tarif/km</th>
                  <th className="text-right px-4 py-2 font-medium">Km min.</th>
                  <th className="text-left px-4 py-2 font-medium">Notă</th>
                  <th className="px-4 py-2" />
                </tr>
              </thead>
              <tbody>
                {group.rows.map((row) => (
                  <tr key={row.id} className="border-t border-slate-100 hover:bg-slate-50">
                    <td className="px-4 py-2 whitespace-nowrap">
                      <span className="text-slate-700">{validityLabel(row)}</span>{' '}
                      <InForceBadge row={row} />
                    </td>
                    <td className="px-4 py-2 text-right tabular-nums">{formatAmount(row.trip_rate) || '—'}</td>
                    <td className="px-4 py-2 text-right tabular-nums">{formatAmount(row.km_rate, 4) || '—'}</td>
                    <td className="px-4 py-2 text-right tabular-nums text-slate-500">{formatAmount(row.min_km, 0) || '—'}</td>
                    <td className="px-4 py-2 text-slate-500">{row.notes || '—'}</td>
                    <td className="px-4 py-2 text-right whitespace-nowrap">
                      <button type="button" className="p-1.5 text-slate-400 hover:text-slate-700" onClick={() => setEditing(row)} title="Editează">
                        <Pencil className="w-4 h-4" />
                      </button>
                      <button type="button" className="p-1.5 text-slate-400 hover:text-red-600" onClick={() => remove(row)} title="Șterge">
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ))}

      {editing ? (
        <TariffForm
          contracts={data.contracts}
          classes={data.fleet_vehicle_classes}
          initial={editing}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); reload(); }}
        />
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------- zone

function ZonesTab({ data, reload }) {
  const [zoneForm, setZoneForm] = useState(null);
  const [rateForm, setRateForm] = useState(null);

  const ratesFor = (zoneId) => data.zone_rates.filter((r) => r.tax_zone_id === zoneId);

  const saveZone = async (form) => {
    try {
      const payload = {
        code: form.code.trim(),
        name: form.name.trim(),
        kind: form.kind || 'custom',
        matcher: form.matcher ? JSON.parse(form.matcher) : null,
        priority: Number(form.priority) || 0,
        is_active: form.is_active !== false,
      };
      if (form.id) await api.entities.TaxZone.update(form.id, payload);
      else await api.entities.TaxZone.create(payload);
      notifySuccess('Zonă salvată');
      setZoneForm(null);
      reload();
    } catch (err) {
      notifyError('Salvarea zonei a eșuat', err);
    }
  };

  const saveRate = async (form) => {
    const errors = validateZoneRate(form);
    if (Object.keys(errors).length) {
      notifyError('Completează câmpurile', Object.values(errors).join(' '));
      return;
    }
    try {
      const payload = {
        tax_zone_id: form.tax_zone_id,
        mma_min_kg: parseAmount(form.mma_min_kg),
        mma_max_kg: parseAmount(form.mma_max_kg),
        amount: parseAmount(form.amount),
        currency: form.currency || 'RON',
        valid_from: form.valid_from,
        valid_to: form.valid_to || null,
      };
      if (form.id) await api.entities.TaxZoneRate.update(form.id, payload);
      else await api.entities.TaxZoneRate.create(payload);
      notifySuccess('Tarif de zonă salvat');
      setRateForm(null);
      reload();
    } catch (err) {
      notifyError('Salvarea a eșuat', err);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-slate-500">
          Taxa de zonă se calculează după <strong>MMA-ul din talon</strong>, nu după marfa
          încărcată.
        </p>
        <button type="button" className={btnPrimary} onClick={() => setZoneForm({ kind: 'oras', priority: 0 })}>
          <Plus className="w-4 h-4" /> Zonă nouă
        </button>
      </div>

      {data.zones.length === 0 ? (
        <Empty>Nicio zonă definită. Fără zone, taxele geografice nu se pot calcula.</Empty>
      ) : data.zones.map((zone) => (
        <section key={zone.id} className="bg-white rounded-xl border border-slate-200 overflow-hidden">
          <div className="px-4 py-2.5 bg-slate-50 border-b border-slate-200 flex flex-wrap items-center gap-2">
            <span className="font-semibold text-sm text-slate-800">{zone.code}</span>
            <span className="text-sm text-slate-600">{zone.name}</span>
            {!zone.is_active ? <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-slate-100 text-slate-500">inactivă</span> : null}
            {zone.polygon ? (
              <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-blue-50 text-blue-700 border border-blue-200">poligon</span>
            ) : (
              <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-slate-50 text-slate-500 border border-slate-200">potrivire textuală</span>
            )}
            <div className="ml-auto flex gap-2">
              <button type="button" className="text-xs px-2 py-1 rounded border border-slate-200 text-slate-600 hover:bg-white"
                onClick={() => setRateForm({ tax_zone_id: zone.id, currency: 'RON' })}>
                + Tranșă MMA
              </button>
              <button type="button" className="p-1 text-slate-400 hover:text-slate-700"
                onClick={() => setZoneForm({ ...zone, matcher: zone.matcher ? JSON.stringify(zone.matcher) : '' })}>
                <Pencil className="w-4 h-4" />
              </button>
            </div>
          </div>
          {ratesFor(zone.id).length === 0 ? (
            <p className="px-4 py-3 text-sm text-slate-500">
              Zona nu are niciun tarif — nu va produce nicio taxă.
            </p>
          ) : (
            <table className="min-w-full text-sm">
              <tbody>
                {ratesFor(zone.id).map((rate) => (
                  <tr key={rate.id} className="border-t border-slate-100">
                    <td className="px-4 py-2 text-slate-700">{bracketLabel(rate)}</td>
                    <td className="px-4 py-2 text-right tabular-nums font-medium">
                      {formatAmount(rate.amount)} {rate.currency}
                    </td>
                    <td className="px-4 py-2 text-slate-500 whitespace-nowrap">
                      {validityLabel(rate)} <InForceBadge row={rate} />
                    </td>
                    <td className="px-4 py-2 text-right">
                      <button type="button" className="p-1 text-slate-400 hover:text-slate-700" onClick={() => setRateForm(rate)}>
                        <Pencil className="w-4 h-4" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      ))}

      {zoneForm ? <ZoneModal initial={zoneForm} onClose={() => setZoneForm(null)} onSave={saveZone} /> : null}
      {rateForm ? <ZoneRateModal initial={rateForm} onClose={() => setRateForm(null)} onSave={saveRate} /> : null}
    </div>
  );
}

function ZoneModal({ initial, onClose, onSave }) {
  const [form, setForm] = useState({ code: '', name: '', kind: 'oras', matcher: '', priority: 0, is_active: true, ...initial });
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));
  return (
    <ModalShell open onClose={onClose} title={initial?.id ? 'Editează zona' : 'Zonă nouă'}>
      <form className="p-5 space-y-4" onSubmit={(e) => { e.preventDefault(); onSave(form); }}>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Cod"><input className={inputCls} value={form.code} onChange={(e) => set('code', e.target.value)} placeholder="ZB" /></Field>
          <Field label="Nume"><input className={inputCls} value={form.name} onChange={(e) => set('name', e.target.value)} placeholder="Zona B" /></Field>
          <Field label="Tip">
            <select className={inputCls} value={form.kind} onChange={(e) => set('kind', e.target.value)}>
              {ZONE_KINDS.map((k) => <option key={k.value} value={k.value}>{k.label}</option>)}
            </select>
          </Field>
          <Field label="Prioritate" hint="Cea mai mare câștigă când se suprapun">
            <input type="number" className={inputCls} value={form.priority} onChange={(e) => set('priority', e.target.value)} />
          </Field>
        </div>
        <Field
          label="Potrivire textuală (JSON)"
          hint='Ex.: {"counties":["IF"],"cities":["Otopeni","Voluntari"]} — funcționează înainte de a desena un poligon'
        >
          <textarea rows={3} className={`${inputCls} font-mono text-xs`} value={form.matcher || ''} onChange={(e) => set('matcher', e.target.value)} />
        </Field>
        <label className="flex items-center gap-2 text-sm text-slate-600">
          <input type="checkbox" checked={form.is_active !== false} onChange={(e) => set('is_active', e.target.checked)} />
          Zonă activă
        </label>
        <div className="flex justify-end gap-2">
          <button type="button" className={btnGhost} onClick={onClose}>Anulează</button>
          <button type="submit" className={btnPrimary}><Check className="w-4 h-4" /> Salvează</button>
        </div>
      </form>
    </ModalShell>
  );
}

function ZoneRateModal({ initial, onClose, onSave }) {
  const [form, setForm] = useState({ mma_min_kg: '', mma_max_kg: '', amount: '', currency: 'RON', valid_from: '', valid_to: '', ...initial });
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));
  return (
    <ModalShell open onClose={onClose} title="Tranșă de MMA">
      <form className="p-5 space-y-4" onSubmit={(e) => { e.preventDefault(); onSave(form); }}>
        <div className="grid grid-cols-2 gap-3">
          <Field label="MMA de la (kg)" hint="Gol = fără limită jos">
            <input className={inputCls} value={form.mma_min_kg ?? ''} onChange={(e) => set('mma_min_kg', e.target.value)} placeholder="3500" />
          </Field>
          <Field label="MMA până la (kg)" hint="Gol = fără limită sus">
            <input className={inputCls} value={form.mma_max_kg ?? ''} onChange={(e) => set('mma_max_kg', e.target.value)} placeholder="7500" />
          </Field>
          <Field label="Sumă (lei)"><input className={inputCls} value={form.amount ?? ''} onChange={(e) => set('amount', e.target.value)} /></Field>
          <Field label="Monedă"><input className={inputCls} value={form.currency} onChange={(e) => set('currency', e.target.value)} /></Field>
          <Field label="Valabil de la"><input type="date" className={inputCls} value={form.valid_from || ''} onChange={(e) => set('valid_from', e.target.value)} /></Field>
          <Field label="Valabil până la"><input type="date" className={inputCls} value={form.valid_to || ''} onChange={(e) => set('valid_to', e.target.value)} /></Field>
        </div>
        <div className="flex justify-end gap-2">
          <button type="button" className={btnGhost} onClick={onClose}>Anulează</button>
          <button type="submit" className={btnPrimary}><Check className="w-4 h-4" /> Salvează</button>
        </div>
      </form>
    </ModalShell>
  );
}

// ---------------------------------------------------------------- surcharges

function SurchargesTab({ data, reload }) {
  const [typeForm, setTypeForm] = useState(null);
  const [rateForm, setRateForm] = useState(null);

  const ratesFor = (typeId) => data.surcharge_rates.filter((r) => r.surcharge_type_id === typeId);

  const saveType = async (form) => {
    try {
      const payload = {
        code: form.code.trim().toUpperCase(),
        name: form.name.trim(),
        applies_per: form.applies_per || 'trip',
        is_active: form.is_active !== false,
      };
      if (form.id) await api.entities.SurchargeType.update(form.id, payload);
      else await api.entities.SurchargeType.create(payload);
      notifySuccess('Taxă salvată');
      setTypeForm(null);
      reload();
    } catch (err) {
      notifyError('Salvarea a eșuat', err);
    }
  };

  const saveRate = async (form) => {
    const errors = validateSurchargeRate(form);
    if (Object.keys(errors).length) {
      notifyError('Completează câmpurile', Object.values(errors).join(' '));
      return;
    }
    try {
      const payload = {
        surcharge_type_id: form.surcharge_type_id,
        vehicle_class: form.vehicle_class?.trim() || null,
        amount: parseAmount(form.amount),
        currency: form.currency || 'RON',
        valid_from: form.valid_from,
        valid_to: form.valid_to || null,
      };
      if (form.id) await api.entities.SurchargeRate.update(form.id, payload);
      else await api.entities.SurchargeRate.create(payload);
      notifySuccess('Tarif salvat');
      setRateForm(null);
      reload();
    } catch (err) {
      notifyError('Salvarea a eșuat', err);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-slate-500">
          Taxa de macara (<code className="text-xs">DM</code>) și celelalte taxe suplimentare.
          Suma poate diferi pe clasă de vehicul.
        </p>
        <button type="button" className={btnPrimary} onClick={() => setTypeForm({ applies_per: 'trip' })}>
          <Plus className="w-4 h-4" /> Taxă nouă
        </button>
      </div>

      {data.surcharge_types.length === 0 ? (
        <Empty>Nicio taxă suplimentară definită.</Empty>
      ) : data.surcharge_types.map((type) => (
        <section key={type.id} className="bg-white rounded-xl border border-slate-200 overflow-hidden">
          <div className="px-4 py-2.5 bg-slate-50 border-b border-slate-200 flex flex-wrap items-center gap-2">
            <span className="font-mono text-xs px-1.5 py-0.5 rounded bg-white border border-slate-200">{type.code}</span>
            <span className="font-semibold text-sm text-slate-800">{type.name}</span>
            <span className="text-xs text-slate-500">
              {APPLIES_PER.find((a) => a.value === type.applies_per)?.label ?? type.applies_per}
            </span>
            {!type.is_active ? <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-slate-100 text-slate-500">inactivă</span> : null}
            <div className="ml-auto flex gap-2">
              <button type="button" className="text-xs px-2 py-1 rounded border border-slate-200 text-slate-600 hover:bg-white"
                onClick={() => setRateForm({ surcharge_type_id: type.id, currency: 'RON' })}>
                + Tarif
              </button>
              <button type="button" className="p-1 text-slate-400 hover:text-slate-700" onClick={() => setTypeForm(type)}>
                <Pencil className="w-4 h-4" />
              </button>
            </div>
          </div>
          {ratesFor(type.id).length === 0 ? (
            <p className="px-4 py-3 text-sm text-slate-500">Fără tarif — taxa nu se va aplica.</p>
          ) : (
            <table className="min-w-full text-sm">
              <tbody>
                {ratesFor(type.id).map((rate) => (
                  <tr key={rate.id} className="border-t border-slate-100">
                    <td className="px-4 py-2 text-slate-700">{rate.vehicle_class || 'orice clasă'}</td>
                    <td className="px-4 py-2 text-right tabular-nums font-medium">{formatAmount(rate.amount)} {rate.currency}</td>
                    <td className="px-4 py-2 text-slate-500 whitespace-nowrap">
                      {validityLabel(rate)} <InForceBadge row={rate} />
                    </td>
                    <td className="px-4 py-2 text-right">
                      <button type="button" className="p-1 text-slate-400 hover:text-slate-700" onClick={() => setRateForm(rate)}>
                        <Pencil className="w-4 h-4" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      ))}

      {typeForm ? (
        <ModalShell open onClose={() => setTypeForm(null)} title={typeForm.id ? 'Editează taxa' : 'Taxă nouă'}>
          <SurchargeTypeForm initial={typeForm} onClose={() => setTypeForm(null)} onSave={saveType} />
        </ModalShell>
      ) : null}
      {rateForm ? (
        <ModalShell open onClose={() => setRateForm(null)} title="Tarif taxă">
          <SurchargeRateForm initial={rateForm} classes={data.fleet_vehicle_classes} onClose={() => setRateForm(null)} onSave={saveRate} />
        </ModalShell>
      ) : null}
    </div>
  );
}

function SurchargeTypeForm({ initial, onClose, onSave }) {
  const [form, setForm] = useState({ code: '', name: '', applies_per: 'trip', is_active: true, ...initial });
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));
  return (
    <form className="p-5 space-y-4" onSubmit={(e) => { e.preventDefault(); onSave(form); }}>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Cod" hint="Codul de pe aviz, ex. DM">
          <input className={inputCls} value={form.code} onChange={(e) => set('code', e.target.value)} placeholder="DM" />
        </Field>
        <Field label="Denumire">
          <input className={inputCls} value={form.name} onChange={(e) => set('name', e.target.value)} placeholder="Descărcare cu macara" />
        </Field>
        <Field label="Se aplică">
          <select className={inputCls} value={form.applies_per} onChange={(e) => set('applies_per', e.target.value)}>
            {APPLIES_PER.map((a) => <option key={a.value} value={a.value}>{a.label}</option>)}
          </select>
        </Field>
      </div>
      <label className="flex items-center gap-2 text-sm text-slate-600">
        <input type="checkbox" checked={form.is_active !== false} onChange={(e) => set('is_active', e.target.checked)} />
        Activă
      </label>
      <div className="flex justify-end gap-2">
        <button type="button" className={btnGhost} onClick={onClose}>Anulează</button>
        <button type="submit" className={btnPrimary}><Check className="w-4 h-4" /> Salvează</button>
      </div>
    </form>
  );
}

function SurchargeRateForm({ initial, classes, onClose, onSave }) {
  const [form, setForm] = useState({ vehicle_class: '', amount: '', currency: 'RON', valid_from: '', valid_to: '', ...initial });
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));
  return (
    <form className="p-5 space-y-4" onSubmit={(e) => { e.preventDefault(); onSave(form); }}>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Clasă vehicul" hint="Gol = se aplică oricărei clase">
          <input className={inputCls} list="surcharge-classes" value={form.vehicle_class ?? ''} onChange={(e) => set('vehicle_class', e.target.value)} />
          <datalist id="surcharge-classes">
            {[...new Set([...(classes ?? []), ...VEHICLE_CLASSES])].map((c) => <option key={c} value={c} />)}
          </datalist>
        </Field>
        <Field label="Sumă (lei)"><input className={inputCls} value={form.amount ?? ''} onChange={(e) => set('amount', e.target.value)} /></Field>
        <Field label="Valabil de la"><input type="date" className={inputCls} value={form.valid_from || ''} onChange={(e) => set('valid_from', e.target.value)} /></Field>
        <Field label="Valabil până la"><input type="date" className={inputCls} value={form.valid_to || ''} onChange={(e) => set('valid_to', e.target.value)} /></Field>
      </div>
      <div className="flex justify-end gap-2">
        <button type="button" className={btnGhost} onClick={onClose}>Anulează</button>
        <button type="submit" className={btnPrimary}><Check className="w-4 h-4" /> Salvează</button>
      </div>
    </form>
  );
}

// ------------------------------------------------------------------- coduri

function CodesTab({ data, reload }) {
  const [importing, setImporting] = useState(false);
  const [preview, setPreview] = useState(null);

  const onFile = async (e, dryRun) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setImporting(true);
    try {
      const result = await api.commercial.importCodes(file, { dryRun });
      if (dryRun) {
        setPreview(result);
      } else {
        notifySuccess(`${result.imported} coduri importate`,
          result.skipped.length ? `${result.skipped.length} rânduri sărite` : undefined);
        setPreview(null);
        reload();
      }
    } catch (err) {
      notifyError('Import eșuat', err);
    } finally {
      setImporting(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="rounded-lg bg-slate-50 border border-slate-200 px-4 py-3">
        <p className="text-sm text-slate-600">
          Codurile sunt ale clientului, nu inventate de noi. Importă lista lor dintr-un fișier cu
          antetul <code className="text-xs">Cod | Descriere | Tip | Activ</code> (.xlsx sau .csv).
        </p>
        <div className="flex flex-wrap gap-2 mt-3">
          <label className={`${btnGhost} cursor-pointer`}>
            <Upload className="w-4 h-4" /> Previzualizează un fișier
            <input type="file" accept=".xlsx,.csv" className="hidden" onChange={(e) => onFile(e, true)} disabled={importing} />
          </label>
          <label className={`${btnPrimary} cursor-pointer`}>
            {importing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
            Importă
            <input type="file" accept=".xlsx,.csv" className="hidden" onChange={(e) => onFile(e, false)} disabled={importing} />
          </label>
        </div>
      </div>

      {preview ? (
        <div className="rounded-lg border border-blue-200 bg-blue-50 px-4 py-3">
          <p className="text-sm text-blue-900 font-medium">
            Previzualizare: {preview.codes.length} coduri, {preview.skipped.length} rânduri sărite
          </p>
          {preview.skipped.length ? (
            <ul className="text-xs text-blue-800 mt-1 list-disc pl-5">
              {preview.skipped.slice(0, 5).map((s) => (
                <li key={`${s.line}-${s.reason}`}>rândul {s.line}: {s.reason}</li>
              ))}
            </ul>
          ) : null}
          <button type="button" className="text-xs underline text-blue-800 mt-2" onClick={() => setPreview(null)}>
            Închide previzualizarea
          </button>
        </div>
      ) : null}

      <section className="bg-white rounded-xl border border-slate-200 overflow-hidden">
        {data.observation_codes.length === 0 ? (
          <Empty>Niciun cod. Importă lista clientului.</Empty>
        ) : (
          <table className="min-w-full text-sm">
            <thead className="bg-slate-50">
              <tr className="text-[11px] uppercase text-slate-500">
                <th className="text-left px-4 py-2 font-medium">Cod</th>
                <th className="text-left px-4 py-2 font-medium">Descriere</th>
                <th className="text-left px-4 py-2 font-medium">Tip</th>
                <th className="text-left px-4 py-2 font-medium">Stare</th>
              </tr>
            </thead>
            <tbody>
              {data.observation_codes.map((code) => (
                <tr key={code.id} className="border-t border-slate-100">
                  <td className="px-4 py-2 font-mono text-xs">{code.code}</td>
                  <td className="px-4 py-2 text-slate-700">{code.label || '—'}</td>
                  <td className="px-4 py-2 text-slate-500">{code.kind || '—'}</td>
                  <td className="px-4 py-2">
                    {code.is_active === false
                      ? <span className="text-xs text-slate-400">inactiv</span>
                      : <span className="text-xs text-emerald-700">activ</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}

// -------------------------------------------------------------------- garaj

function DepotTab({ data, reload }) {
  const [saving, setSaving] = useState(false);
  const [selected, setSelected] = useState(data.depot_location_id ?? '');
  const current = data.locations.find((l) => l.id === data.depot_location_id) ?? null;

  const save = async () => {
    setSaving(true);
    try {
      await api.commercial.setDepot(selected || null);
      notifySuccess('Garaj salvat');
      reload();
    } catch (err) {
      notifyError('Salvarea a eșuat', err);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-4 max-w-2xl">
      <div className="rounded-lg bg-slate-50 border border-slate-200 px-4 py-3">
        <p className="text-sm text-slate-600">
          Kilometrii fiecărei curse se măsoară <strong>garaj → încărcare → descărcări → garaj</strong>.
          Fără garaj setat, drumul dus-întors nu se poate calcula, iar TPO-ul rămâne fără
          componenta de kilometri.
        </p>
      </div>

      {current ? (
        <div className="flex items-center gap-2 text-sm text-slate-700">
          <MapPin className="w-4 h-4 text-emerald-600" />
          Garaj curent: <strong>{current.name}</strong>
          <span className="text-slate-500">{[current.city, current.county].filter(Boolean).join(', ')}</span>
        </div>
      ) : (
        <div className="flex gap-2 items-start rounded-lg border border-amber-200 bg-amber-50 px-3 py-2">
          <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
          <p className="text-sm text-amber-800">Niciun garaj setat.</p>
        </div>
      )}

      <div className="flex items-end gap-2">
        <div className="flex-1">
          <span className={labelCls}>Locație</span>
          <select className={inputCls} value={selected} onChange={(e) => setSelected(e.target.value)}>
            <option value="">— fără garaj —</option>
            {data.locations.map((l) => (
              <option key={l.id} value={l.id} disabled={l.latitude == null}>
                {l.name}
                {[l.city, l.county].filter(Boolean).length ? ` (${[l.city, l.county].filter(Boolean).join(', ')})` : ''}
                {l.latitude == null ? ' — fără coordonate' : ''}
              </option>
            ))}
          </select>
          <p className="text-[11px] text-slate-400 mt-1">
            O locație fără coordonate nu poate fi garaj — geocodeaz-o întâi din ecranul Locații.
          </p>
        </div>
        <button type="button" className={btnPrimary} onClick={save} disabled={saving}>
          {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
          Salvează
        </button>
      </div>
    </div>
  );
}

// --------------------------------------------------------------------- page

export default function Commercial() {
  const [tab, setTab] = useState('tarife');
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setData(await api.commercial.overview());
    } catch (err) {
      notifyError('Configurarea nu s-a încărcat', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  if (loading && !data) {
    return (
      <div className="p-10 flex justify-center">
        <Loader2 className="w-6 h-6 text-slate-300 animate-spin" />
      </div>
    );
  }
  if (!data) return null;

  return (
    <div className="p-6 space-y-5 max-w-[1200px] mx-auto">
      <header className="flex flex-wrap items-start gap-3">
        <div className="min-w-0 flex-1">
          <h1 className="text-xl font-semibold text-slate-800">Configurare comercială</h1>
          <p className="text-sm text-slate-500">
            Tarifele negociate, taxele de zonă și codurile clientului — tot ce stă în spatele
            calculului de TPO.
          </p>
        </div>
        <button type="button" className={btnGhost} onClick={load} disabled={loading}>
          {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
          Reîncarcă
        </button>
      </header>

      <div className="flex gap-1 border-b border-slate-200 overflow-x-auto">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            className={`px-3 py-2 text-sm whitespace-nowrap border-b-2 -mb-px transition-colors ${
              tab === t.id
                ? 'border-[#1D4E89] text-[#1D4E89] font-medium'
                : 'border-transparent text-slate-500 hover:text-slate-700'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'tarife' ? <TariffsTab data={data} reload={load} /> : null}
      {tab === 'zone' ? <ZonesTab data={data} reload={load} /> : null}
      {tab === 'taxe' ? <SurchargesTab data={data} reload={load} /> : null}
      {tab === 'coduri' ? <CodesTab data={data} reload={load} /> : null}
      {tab === 'garaj' ? <DepotTab data={data} reload={load} /> : null}
    </div>
  );
}
