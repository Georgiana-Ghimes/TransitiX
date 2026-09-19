/**
 * Autoturisme: the plates the documents flow has seen, and the one figure it needs from each.
 *
 * The Bucharest zone fee is charged on MTMA, which is a fact about the lorry and not about the
 * trip. An aviz only carries the plate, so until this screen existed the figure had nowhere to
 * live and the operator typed the fee by hand into "Taxe suplimentare" every time.
 *
 * Rows the OCR opened on its own are marked as such. A misread plate produces a lorry that
 * never existed, and presenting it as fleet somebody entered would leave an alert nobody can
 * explain or clear.
 */
import React, { useEffect, useMemo, useState } from 'react';
import {
  Loader2, Truck, Plus, Check, TriangleAlert, ScanLine, Trash2, Search, Pencil, X,
} from 'lucide-react';
import { api } from '@/api/client';
import { notifyError, notifySuccess } from '@/lib/notify';
import { canonicalPlateClient, parseMmaKg, mmaLabel, sanitizeMmaInput } from '@/lib/fleetUi';

const cardCls = 'bg-white rounded-xl border border-slate-200/80 shadow-sm';
const inputCls = 'w-full h-10 px-3 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#1D4E89]/30';

export default function Fleet() {
  const [vehicles, setVehicles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('');
  const [adding, setAdding] = useState(false);
  const [newPlate, setNewPlate] = useState('');
  const [newMma, setNewMma] = useState('');
  const [saving, setSaving] = useState(null);

  useEffect(() => {
    load();
  }, []);

  const load = async () => {
    setLoading(true);
    try {
      const rows = await api.entities.Vehicle.list('plate', 500);
      setVehicles(Array.isArray(rows) ? rows : []);
    } catch (err) {
      notifyError('Lista de vehicule nu a putut fi încărcată', err);
    } finally {
      setLoading(false);
    }
  };

  const shown = useMemo(() => {
    const needle = filter.trim().toLowerCase();
    const active = vehicles.filter((v) => v.is_active !== false);
    if (!needle) return active;
    return active.filter((v) => String(v.plate || '').toLowerCase().includes(needle));
  }, [vehicles, filter]);

  const missing = shown.filter((v) => v.mma_kg == null);

  const saveMma = async (vehicle, raw) => {
    const kg = parseMmaKg(raw);
    if (raw.trim() !== '' && kg == null) {
      notifyError('MTMA invalid', 'Scrie masa în kilograme, de exemplu 40000.');
      return;
    }
    setSaving(vehicle.id);
    try {
      // Saving the figure is also the confirmation: somebody looked at this plate and accepted
      // it, so it stops being an unreviewed OCR guess.
      await api.entities.Vehicle.update(vehicle.id, { mma_kg: kg, added_by_ocr: false });
      notifySuccess(`${vehicle.plate} actualizat`, kg == null ? 'MTMA șters.' : `MTMA ${mmaLabel(kg)}.`);
      await load();
    } catch (err) {
      notifyError('Salvarea a eșuat', err);
    } finally {
      setSaving(null);
    }
  };

  const addVehicle = async (e) => {
    e?.preventDefault();
    const plate = canonicalPlateClient(newPlate);
    if (!plate) {
      notifyError('Număr invalid', 'Scrie un număr de înmatriculare, de exemplu B 112 VFM.');
      return;
    }
    if (vehicles.some((v) => String(v.plate || '').toUpperCase() === plate)) {
      notifyError('Există deja', `${plate} este deja în listă.`);
      return;
    }
    const kg = parseMmaKg(newMma);
    setSaving('new');
    try {
      await api.entities.Vehicle.create({ plate, mma_kg: kg, is_active: true });
      notifySuccess(`${plate} adăugat`, kg == null ? 'Completează MTMA când îl afli.' : `MTMA ${mmaLabel(kg)}.`);
      setNewPlate('');
      setNewMma('');
      setAdding(false);
      await load();
    } catch (err) {
      notifyError('Adăugarea a eșuat', err);
    } finally {
      setSaving(null);
    }
  };

  const removeVehicle = async (vehicle) => {
    setSaving(vehicle.id);
    try {
      // Retired, not erased: a lorry that carried documents stays referenced by them.
      await api.entities.Vehicle.update(vehicle.id, { is_active: false });
      notifySuccess(`${vehicle.plate} scos din listă`, 'Nu mai cere MTMA și nu mai apare aici.');
      await load();
    } catch (err) {
      notifyError('Operația a eșuat', err);
    } finally {
      setSaving(null);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-[60vh] text-slate-400">
        <Loader2 className="w-6 h-6 animate-spin" />
      </div>
    );
  }

  return (
    <div className="p-4 sm:p-6 space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-[#0A2B4E]">Autoturisme</h1>
          <p className="text-sm text-slate-500">
            Numerele văzute pe avize. MTMA din talon se scrie o dată pe mașină și se folosește
            la taxa de zonă București.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setAdding((v) => !v)}
          className="inline-flex h-10 items-center gap-2 px-4 text-sm font-medium bg-[#0A2B4E] text-white rounded-lg hover:bg-[#123f6d]"
        >
          <Plus className="w-4 h-4" /> Adaugă mașină
        </button>
      </div>

      {missing.length ? (
        <div className="rounded-xl bg-amber-50 border border-amber-200 p-3 text-sm text-amber-900 flex items-start gap-2">
          <TriangleAlert className="w-4 h-4 shrink-0 mt-0.5" />
          <span>
            <strong>{missing.length === 1 ? 'O mașină nu are MTMA' : `${missing.length} mașini nu au MTMA`}</strong>
            {' — '}
            fără masa din talon nu se poate calcula taxa de zonă pentru cursele lor.
          </span>
        </div>
      ) : null}

      {adding ? (
        <form onSubmit={addVehicle} className={`${cardCls} p-3 flex flex-wrap gap-2 items-start`}>
          <div className="w-44">
            <label className="block text-[11px] font-medium text-slate-500 mb-1">Număr</label>
            <input
              className={inputCls}
              value={newPlate}
              onChange={(e) => setNewPlate(e.target.value)}
              placeholder="B 112 VFM"
              autoFocus
            />
          </div>
          <div className="w-56">
            <label className="block text-[11px] font-medium text-slate-500 mb-1">
              MTMA ansamblu (kg)
            </label>
            <input
              className={inputCls}
              value={newMma}
              onChange={(e) => setNewMma(sanitizeMmaInput(e.target.value))}
              inputMode="numeric"
              pattern="[0-9 .,]*"
              placeholder="40000"
            />
          </div>
          <div className="pt-[22px] flex gap-2">
            <button type="submit" disabled={saving === 'new'}
              className="inline-flex h-10 items-center gap-2 px-4 text-sm font-medium bg-[#0A2B4E] text-white rounded-lg hover:bg-[#123f6d] disabled:opacity-40">
              {saving === 'new' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
              Salvează
            </button>
            <button type="button" onClick={() => setAdding(false)}
              className="h-10 px-4 text-sm border border-slate-200 rounded-lg hover:bg-slate-50">
              Renunță
            </button>
          </div>
          <p className="w-full text-[11px] text-slate-400">
            MTMA este masa totală maximă autorizată din certificatul de înmatriculare, rubrica
            F.3 pentru ansamblu. Nu este sarcina utilă și nu este greutatea mărfii.
          </p>
        </form>
      ) : null}

      <div className={`${cardCls} p-3`}>
        <div className="relative w-full sm:w-72">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            className={`${inputCls} pl-9`}
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Caută după număr"
          />
        </div>
      </div>

      {shown.length === 0 ? (
        <div className={`${cardCls} p-12 text-center text-slate-400`}>
          <Truck className="w-10 h-10 mx-auto mb-3 opacity-40" />
          <p className="text-sm">
            {filter.trim()
              ? 'Niciun număr nu se potrivește.'
              : 'Încă nicio mașină. Se adaugă singure când OCR-ul citește un număr de pe un aviz, sau le poți introduce tu.'}
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {shown.map((vehicle) => (
            <VehicleRow
              key={vehicle.id}
              vehicle={vehicle}
              busy={saving === vehicle.id}
              onSave={(raw) => saveMma(vehicle, raw)}
              onRemove={() => removeVehicle(vehicle)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * One lorry, with its MTMA locked once it has one.
 *
 * The figure is entered once and then read for years. Leaving it in an open box means a stray
 * keystroke on a list somebody is scrolling can change which PMB bracket every future trip is
 * charged at, and nothing on the screen would look wrong afterwards. Editing is deliberate:
 * the pencil unlocks it, Escape puts it back.
 */
function VehicleRow({ vehicle, busy, onSave, onRemove }) {
  const stored = vehicle.mma_kg == null ? '' : String(Math.round(Number(vehicle.mma_kg)));
  const missing = vehicle.mma_kg == null;
  // A lorry with no MTMA yet is the thing this screen exists for, so that one starts open.
  const [editing, setEditing] = useState(missing);
  const [value, setValue] = useState(stored);
  const dirty = value.trim() !== stored;

  const cancel = () => {
    setValue(stored);
    setEditing(false);
  };

  return (
    <div className={`${cardCls} p-3 flex flex-wrap items-center gap-x-4 gap-y-2 ${missing ? 'ring-1 ring-amber-200' : ''}`}>
      <span className="font-mono text-sm font-semibold text-slate-800 w-36">{vehicle.plate}</span>

      {vehicle.brand || vehicle.model ? (
        <span className="text-xs text-slate-500">{[vehicle.brand, vehicle.model].filter(Boolean).join(' ')}</span>
      ) : null}

      {vehicle.added_by_ocr ? (
        <span className="inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full bg-sky-50 text-sky-800">
          <ScanLine className="w-3 h-3" /> din OCR, neverificat
        </span>
      ) : null}

      <div className="ml-auto flex items-center gap-2">
        <label className="text-[11px] text-slate-500 whitespace-nowrap">MTMA (kg)</label>
        <input
          className={`w-28 h-9 px-2 text-sm text-right border rounded-lg focus:outline-none focus:ring-2 focus:ring-[#1D4E89]/30 ${
            editing
              ? 'border-slate-200 bg-white text-slate-800'
              : 'border-transparent bg-slate-50 text-slate-500 cursor-default'
          }`}
          value={value}
          onChange={(e) => setValue(sanitizeMmaInput(e.target.value))}
          onKeyDown={(e) => {
            if (e.key === 'Escape') cancel();
            if (e.key === 'Enter' && dirty) onSave(value);
          }}
          readOnly={!editing}
          inputMode="numeric"
          pattern="[0-9 .,]*"
          placeholder="—"
        />

        {editing ? (
          <>
            <button
              type="button"
              onClick={() => onSave(value)}
              disabled={busy || !dirty}
              className="inline-flex h-9 items-center gap-1.5 px-3 text-xs font-medium border border-slate-200 rounded-lg hover:bg-slate-50 disabled:opacity-40"
            >
              {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
              Salvează
            </button>
            {missing ? null : (
              <button type="button" onClick={cancel} disabled={busy} title="Renunță"
                className="p-2 text-slate-400 hover:text-slate-700 disabled:opacity-40">
                <X className="w-4 h-4" />
              </button>
            )}
          </>
        ) : (
          <button
            type="button"
            onClick={() => setEditing(true)}
            disabled={busy}
            title="Editează MTMA"
            className="p-2 text-slate-400 hover:text-[#1D4E89] disabled:opacity-40"
          >
            <Pencil className="w-4 h-4" />
          </button>
        )}

        <button
          type="button"
          onClick={onRemove}
          disabled={busy}
          title="Scoate din listă"
          className="p-2 text-slate-400 hover:text-rose-700 disabled:opacity-40"
        >
          <Trash2 className="w-4 h-4" />
        </button>
      </div>

      {missing ? (
        <p className="w-full text-[11px] text-amber-700">
          Fără MTMA nu se poate alege tranșa PMB pentru cursele acestei mașini.
        </p>
      ) : null}
    </div>
  );
}
