import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '@/api/client';
import { toFiniteNumber } from '@/lib/utils';
import { mmaLabel } from '@/lib/fleetUi';
import {
  FLEET_FIXABLE, avizDeliveryAddress, avizZoneTax, resolveAvizZone, zoneTaxMessage,
} from '@/lib/avizZoneTax';

const lei = (n) => `${Number(n).toLocaleString('ro-RO')} lei`;

/** Empty, or a stored zero: either way nothing an operator typed is at risk of being replaced. */
function isUnset(value) {
  const n = toFiniteNumber(value);
  return String(value ?? '').trim() === '' || n === 0;
}

const TONE = {
  ok: 'border-emerald-200 bg-emerald-50 text-emerald-900',
  outside: 'border-slate-200 bg-slate-50 text-slate-700',
  under_threshold: 'border-slate-200 bg-slate-50 text-slate-700',
  outside_city: 'border-slate-200 bg-slate-50 text-slate-700',
  no_weight: 'border-slate-200 bg-slate-50 text-slate-600',
};

/**
 * Taxa de zonă for the aviz being edited, worked out while it is open.
 *
 * It reads the fields on screen rather than the saved row, so the answer follows the operator:
 * typing the greutate brută that OCR missed produces the fee on the spot, which is the whole
 * reason the weight is the gate.
 *
 * The fee is filled into Taxe suplimentare only while that field is still empty or zero. An
 * operator who typed 150 lei for a crane has said something this cannot know, and overwriting
 * it would be the app deciding it knows the job better than the person doing it.
 */
export default function AvizZoneTaxPanel({ editRow, form, setForm }) {
  const [vehicles, setVehicles] = useState(null);
  const [zoneResult, setZoneResult] = useState(undefined);
  const appliedFor = useRef(null);

  const address = useMemo(() => avizDeliveryAddress(editRow), [editRow]);

  useEffect(() => {
    let alive = true;
    api.entities.Vehicle.list('plate', 500)
      .then((rows) => { if (alive) setVehicles(rows || []); })
      .catch(() => { if (alive) setVehicles([]); });
    return () => { alive = false; };
  }, []);

  useEffect(() => {
    let alive = true;
    setZoneResult(undefined);
    resolveAvizZone(address)
      .then((res) => { if (alive) setZoneResult(res); })
      .catch(() => { if (alive) setZoneResult(null); });
    return () => { alive = false; };
  }, [address]);

  const loading = vehicles === null || zoneResult === undefined;

  const result = useMemo(() => {
    if (loading) return null;
    return avizZoneTax({
      // The values on screen, not the saved ones: the weight is usually being typed right now.
      aviz: {
        ...editRow,
        gross_weight_kg: form.gross_weight_kg,
        numar_auto: form.numar_auto,
      },
      vehicles,
      zoneResult,
      address,
    });
  }, [loading, editRow, form.gross_weight_kg, form.numar_auto, vehicles, zoneResult, address]);

  const amount = result?.status === 'ok' ? result.amount : null;

  useEffect(() => {
    if (amount == null) return;
    const key = `${editRow?.id}:${amount}`;
    // Once per document and amount. Cleared afterwards means the operator cleared it, and
    // filling it back in would be an argument with the person the field belongs to.
    if (appliedFor.current === key) return;
    if (!isUnset(form.taxe_suplimentare)) return;
    appliedFor.current = key;
    setForm((prev) => ({ ...prev, taxe_suplimentare: String(amount) }));
  }, [amount, editRow?.id, form.taxe_suplimentare, setForm]);

  if (loading) {
    return (
      <div className="sm:col-span-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-500">
        Taxă zonă: se calculează…
      </div>
    );
  }

  const tone = TONE[result.status] || 'border-amber-200 bg-amber-50 text-amber-900';
  const message = zoneTaxMessage(result.status);
  const applied = !isUnset(form.taxe_suplimentare)
    && toFiniteNumber(form.taxe_suplimentare) === amount;

  return (
    <div className={`sm:col-span-2 rounded-lg border px-3 py-2 text-xs ${tone}`}>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <span className="font-medium">Taxă zonă București</span>
        {result.zoneCode && <span className="px-1.5 py-0.5 rounded bg-white/70 border border-current/20">{result.zoneCode}</span>}
        {amount != null && <span className="font-semibold">{lei(amount)}/zi</span>}
        {result.status === 'outside' && <span>0 lei</span>}
      </div>

      {result.status === 'ok' && (
        <p className="mt-1 opacity-90">
          {`MTMA ${mmaLabel(result.mmaKg)}, interval `}
          {`${(result.bracket.minKg / 1000).toLocaleString('ro-RO')} la `}
          {result.bracket.maxKg == null ? 'peste' : `${(result.bracket.maxKg / 1000).toLocaleString('ro-RO')} t`}
          {`. Brută pe aviz ${Number(result.grossKg).toLocaleString('ro-RO')} kg.`}
        </p>
      )}

      {message && <p className="mt-1 opacity-90">{message}</p>}

      {result.status === 'under_threshold' && result.bracket && (
        <p className="mt-1 opacity-75">
          {`Tariful listat pentru acest interval ar fi ${lei(result.bracket.daily)}/zi.`}
        </p>
      )}

      {result.status === 'mma_suspect' && (
        <p className="mt-1 opacity-90">
          {`Brută ${Number(result.grossKg).toLocaleString('ro-RO')} kg peste MTMA ${mmaLabel(result.mmaKg)}.`}
        </p>
      )}

      <div className="mt-1.5 flex flex-wrap items-center gap-3">
        {amount != null && !applied && (
          <button
            type="button"
            className="underline font-medium"
            onClick={() => setForm((prev) => ({ ...prev, taxe_suplimentare: String(amount) }))}
          >
            {isUnset(form.taxe_suplimentare)
              ? `Pune ${lei(amount)} în Taxe suplimentare`
              : `Înlocuiește Taxe suplimentare cu ${lei(amount)}`}
          </button>
        )}
        {applied && <span className="opacity-75">Trecut în Taxe suplimentare.</span>}
        {FLEET_FIXABLE.has(result.status) && (
          <Link to="/fleet" className="underline font-medium">Deschide Autoturisme</Link>
        )}
        {(result.status === 'address_unsure' || result.status === 'address_unknown') && (
          <Link to="/zone-map" className="underline font-medium">Verifică pe Harta zonelor</Link>
        )}
      </div>
    </div>
  );
}
