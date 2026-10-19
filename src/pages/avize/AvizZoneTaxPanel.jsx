import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '@/api/client';
import { toFiniteNumber } from '@/lib/utils';
import { mmaLabel } from '@/lib/fleetUi';
import {
  FLEET_FIXABLE,
  avizDeliveryAddress,
  avizRouteZoneLegs,
  avizZoneTaxTrip,
  formatZoneTaxBreakdown,
  resolveAvizZone,
  zoneMapHref,
  zoneTaxAutoFormPatch,
  zoneTaxMessage,
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

function formatAddressLine(address) {
  if (!address?.street && !address?.locality) return null;
  return [
    [address.street, address.number].filter(Boolean).join(' '),
    address.locality,
  ].filter(Boolean).join(', ');
}

/**
 * Taxa de zonă for the aviz being edited, worked out while it is open.
 *
 * Only Adresa de livrare (each unload stop on Rută after Expeditor) is resolved.
 * Expeditor / încărcare is never taxed. Distinct zones are listed with their fees; the
 * total is written into Taxe suplimentare (and a breakdown string for the report) while
 * the box still holds the last auto value.
 */
export default function AvizZoneTaxPanel({ editRow, form, setForm }) {
  const [vehicles, setVehicles] = useState(null);
  /** zoneResult by leg id */
  const [zoneById, setZoneById] = useState(null);
  /** Last amount we wrote for this document (`{ id, amount }`). */
  const lastAuto = useRef({ id: null, amount: null });

  const avizForRoute = useMemo(() => ({
    ...editRow,
    ruta_transport: form.ruta_transport ?? editRow?.ruta_transport,
  }), [editRow, form.ruta_transport]);

  const routeLegs = useMemo(() => avizRouteZoneLegs(avizForRoute), [avizForRoute]);
  const deliveryAddress = useMemo(() => avizDeliveryAddress(avizForRoute), [avizForRoute]);
  /** Any typed change to the delivery leg (street, nr, locality, postcode) must re-resolve. */
  const legsKey = useMemo(
    () => routeLegs.map((l) => [
      l.id,
      l.raw || '',
      l.address?.street || '',
      l.address?.number || '',
      l.address?.locality || '',
      l.address?.postcode || '',
    ].join('\u001f')).join('|'),
    [routeLegs],
  );

  useEffect(() => {
    let alive = true;
    api.entities.Vehicle.list('plate', 500)
      .then((rows) => { if (alive) setVehicles(rows || []); })
      .catch(() => { if (alive) setVehicles([]); });
    return () => { alive = false; };
  }, []);

  useEffect(() => {
    let alive = true;
    setZoneById(null);
    const legs = routeLegs;
    const timer = window.setTimeout(() => {
      Promise.all(
        legs.map(async (leg) => {
          if (!leg.address?.street) return [leg.id, null];
          try {
            return [leg.id, await resolveAvizZone(leg.address)];
          } catch {
            return [leg.id, null];
          }
        }),
      ).then((pairs) => {
        if (!alive) return;
        setZoneById(Object.fromEntries(pairs));
      });
    }, 250);
    return () => {
      alive = false;
      window.clearTimeout(timer);
    };
  }, [legsKey, routeLegs]);

  const loading = vehicles === null || zoneById === null;

  const trip = useMemo(() => {
    if (loading) return null;
    return avizZoneTaxTrip({
      aviz: {
        ...editRow,
        gross_weight_kg: form.gross_weight_kg,
        numar_auto: form.numar_auto,
        ruta_transport: form.ruta_transport ?? editRow?.ruta_transport,
      },
      vehicles,
      legs: routeLegs.map((leg) => ({
        ...leg,
        zoneResult: zoneById[leg.id],
      })),
    });
  }, [loading, editRow, form.gross_weight_kg, form.numar_auto, form.ruta_transport, vehicles, routeLegs, zoneById]);

  const amount = trip?.status === 'ok' && Number(trip.amount) > 0 ? trip.amount : null;
  const breakdown = trip ? formatZoneTaxBreakdown(trip) : '';

  useEffect(() => {
    if (editRow?.id !== lastAuto.current.id) {
      lastAuto.current = { id: editRow?.id ?? null, amount: null };
    }
    // Wait until the address resolve finishes — do not clear Taxe while the operator is still typing.
    if (loading || !trip) return;
    const next = zoneTaxAutoFormPatch({
      amount,
      breakdown,
      taxeSuplimentare: form.taxe_suplimentare,
      zoneTaxBreakdown: form.zone_tax_breakdown,
      lastAutoAmount: lastAuto.current.amount,
    });
    lastAuto.current = { id: editRow?.id ?? null, amount: next.lastAutoAmount };
    if (!next.patch) return;
    setForm((prev) => ({ ...prev, ...next.patch }));
  }, [
    loading, trip, amount, breakdown, editRow?.id,
    form.taxe_suplimentare, form.zone_tax_breakdown, setForm,
  ]);

  if (loading || !trip) {
    return (
      <div className="sm:col-span-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-500">
        Taxă zonă: se calculează…
      </div>
    );
  }

  const tone = TONE[trip.status] || 'border-amber-200 bg-amber-50 text-amber-900';
  const message = zoneTaxMessage(trip.status);
  const applied = !isUnset(form.taxe_suplimentare)
    && toFiniteNumber(form.taxe_suplimentare) === amount;
  const mapHref = zoneMapHref(deliveryAddress, { plate: form.numar_auto });
  const legs = Array.isArray(trip.legs) ? trip.legs : [];
  const chargeLines = Array.isArray(trip.chargeLines) ? trip.chargeLines : [];
  const messageOnLeg = legs.some((leg) => {
    const r = leg.result || {};
    const addr = formatAddressLine(leg.address);
    const legMsg = zoneTaxMessage(r.status);
    return Boolean(addr && legMsg && r.status !== 'ok' && r.status !== 'outside');
  });

  return (
    <div className={`sm:col-span-2 rounded-lg border px-3 py-2 text-xs ${tone}`}>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <span className="font-medium">Taxă zonă</span>
        {trip.zones?.map((code) => (
          <span key={code} className="px-1.5 py-0.5 rounded bg-white/70 border border-current/20">{code}</span>
        ))}
        {amount != null && <span className="font-semibold">Total {lei(amount)}/zi</span>}
        {trip.status === 'outside' && !legs.length && <span>0 lei</span>}
      </div>

      {legs.length > 0 && (
        <ul className="mt-1.5 space-y-1 opacity-90">
          {legs.map((leg) => {
            const r = leg.result || {};
            const label = leg.label || leg.role;
            const addr = formatAddressLine(leg.address);
            const legAmount = r.status === 'ok' && Number(r.amount) > 0 ? r.amount : null;
            const legMsg = zoneTaxMessage(r.status);
            return (
              <li key={leg.id || leg.role}>
                <span className="font-medium">{label}</span>
                {r.zoneCode && (
                  <span className="ml-1.5 px-1 py-0.5 rounded bg-white/70 border border-current/20">
                    {r.zoneCode}
                  </span>
                )}
                {legAmount != null && (
                  <span className="ml-1.5 font-semibold">{lei(legAmount)}/zi</span>
                )}
                {r.status === 'outside' && <span className="ml-1.5">0 lei</span>}
                {addr && <span className="ml-1.5">— {addr}</span>}
                {addr && legMsg && r.status !== 'ok' && r.status !== 'outside' && (
                  <span className="ml-1.5">({legMsg})</span>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {chargeLines.length > 1 && (
        <p className="mt-1.5 font-medium opacity-90">
          {`Total taxe zonă: ${lei(amount)}/zi (`}
          {chargeLines.map((l) => `${l.zoneCode} ${lei(l.amount)}`).join(' + ')}
          )
        </p>
      )}

      {trip.status === 'ok' && (
        <p className="mt-1 opacity-90">
          {`MTMA ${mmaLabel(trip.mmaKg)}. Brută pe aviz ${Number(trip.grossKg).toLocaleString('ro-RO')} kg.`}
          {' O taxă pe fiecare zonă distinctă; totalul merge în Taxe suplimentare / raport.'}
        </p>
      )}

      {message && !messageOnLeg && <p className="mt-1 opacity-90">{message}</p>}

      {trip.status === 'under_threshold' && trip.bracket && (
        <p className="mt-1 opacity-75">
          {`Tariful listat pentru acest interval ar fi ${lei(trip.bracket.daily)}/zi.`}
        </p>
      )}

      {trip.status === 'mma_suspect' && (
        <p className="mt-1 opacity-90">
          {`Brută ${Number(trip.grossKg).toLocaleString('ro-RO')} kg peste MTMA ${mmaLabel(trip.mmaKg)}.`}
        </p>
      )}

      <div className="mt-1.5 flex flex-wrap items-center gap-3">
        {amount != null && !applied && (
          <button
            type="button"
            className="underline font-medium"
            onClick={() => setForm((prev) => ({
              ...prev,
              taxe_suplimentare: String(amount),
              zone_tax_breakdown: breakdown,
            }))}
          >
            {isUnset(form.taxe_suplimentare)
              ? `Pune ${lei(amount)} în Taxe suplimentare`
              : `Înlocuiește Taxe suplimentare cu ${lei(amount)}`}
          </button>
        )}
        {applied && <span className="opacity-75">Trecut în Taxe suplimentare.</span>}
        {FLEET_FIXABLE.has(trip.status) && (
          <Link to="/fleet" className="underline font-medium">Deschide Autoturisme</Link>
        )}
        {mapHref && (
          <Link to={mapHref} className="underline font-medium">
            Vezi pinul pe Harta zonelor
          </Link>
        )}
      </div>
    </div>
  );
}
