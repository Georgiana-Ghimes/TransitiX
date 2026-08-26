/**
 * TPO calculation.
 *
 *   TPO = trip rate + kilometre rate + zone taxes + crane and other surcharges
 *
 * Every component is returned as its own line. The total is only ever the sum of the lines,
 * so an invoice query about "why 975 lei" is answered by reading them out rather than by
 * re-deriving the number.
 */

import { findTariff, normaliseClass, num } from './tariffs.js';
import { findSurchargeRate, zoneCharges } from './taxes.js';

function round2(value) {
  return Math.round(num(value) * 100) / 100;
}

export const CHARGE_LABELS = {
  trip_rate: 'Tarif cursă',
  km_rate: 'Tarif kilometri',
  zone_tax: 'Taxă zonă',
  surcharge: 'Taxă suplimentară',
  manual: 'Manual',
};

/**
 * Builds the charge lines for one trip.
 *
 * Nothing here reads the database — everything it needs is passed in, so the whole pricing
 * rulebook is testable without a server and a report can be recomputed for any past date by
 * feeding it the rates that were valid then.
 *
 * @param {object} input
 * @param {object} input.trip           trip row (date, crane flag, manual charges)
 * @param {object} input.vehicle        vehicle row (vehicle_class, mma_kg)
 * @param {Array}  input.tariffs        contract_tariffs rows for the contract
 * @param {object} input.kmSummary      output of summariseLegs
 * @param {Array}  input.zones          tax_zones rows
 * @param {Map}    input.zoneRates      zone id -> tax_zone_rates rows
 * @param {Array}  input.places         points to test against zones
 * @param {Array}  input.surcharges     [{ type, rates }]
 * @param {string} input.onDate         the date the rates are read as of
 */
export function calculateTpo({
  trip = {},
  vehicle = {},
  tariffs = [],
  kmSummary = { distance_km: 0, complete: true },
  zones = [],
  zoneRates = new Map(),
  places = [],
  surcharges = [],
  onDate,
}) {
  const date = onDate ?? String(trip.loading_date ?? '').slice(0, 10);
  const vehicleClass = vehicle.vehicle_class ?? null;
  const mmaKg = vehicle.mma_kg ?? null;

  const lines = [];
  const warnings = [];

  const tariff = findTariff(tariffs, { vehicleClass, onDate: date });
  const currency = tariff?.currency || 'RON';

  if (!tariff) {
    warnings.push({
      code: 'fara_tarif',
      message: vehicleClass
        ? `Nu există tarif contractual valabil la ${date} pentru clasa ${vehicleClass}`
        : `Vehiculul nu are clasă comercială setată — nu se poate alege tariful`,
    });
  }

  // --- trip rate -----------------------------------------------------------
  if (tariff && tariff.trip_rate != null) {
    lines.push({
      kind: 'trip_rate',
      code: 'CURSA',
      label: CHARGE_LABELS.trip_rate,
      quantity: 1,
      unit_amount: round2(tariff.trip_rate),
      amount: round2(tariff.trip_rate),
      currency,
      source: 'auto',
      detail: { vehicle_class: vehicleClass, tariff_id: tariff.id, valid_from: tariff.valid_from },
    });
  }

  // --- kilometres ----------------------------------------------------------
  if (tariff && tariff.km_rate != null) {
    // A contractual minimum protects short runs; the truck still had to come out.
    const drivenKm = round2(kmSummary.distance_km);
    const billedKm = tariff.min_km != null ? Math.max(drivenKm, num(tariff.min_km)) : drivenKm;
    const amount = round2(billedKm * num(tariff.km_rate));
    lines.push({
      kind: 'km_rate',
      code: 'KM',
      label: CHARGE_LABELS.km_rate,
      quantity: billedKm,
      unit_amount: num(tariff.km_rate),
      amount,
      currency,
      source: 'auto',
      detail: {
        driven_km: drivenKm,
        billed_km: billedKm,
        min_km: tariff.min_km == null ? null : num(tariff.min_km),
        km_complete: kmSummary.complete !== false,
      },
    });
    if (kmSummary.complete === false) {
      warnings.push({
        code: 'km_incompleti',
        message: `${kmSummary.missing_legs ?? '?'} segmente nu au distanță — kilometrii sunt incompleți`,
      });
    }
  }

  // --- zone taxes ----------------------------------------------------------
  for (const charge of zoneCharges(zones, zoneRates, places, { mmaKg, onDate: date })) {
    lines.push({
      kind: 'zone_tax',
      code: charge.zone.code,
      label: charge.label,
      quantity: 1,
      unit_amount: charge.amount,
      amount: round2(charge.amount),
      currency: charge.currency,
      source: 'auto',
      detail: charge.detail,
    });
    if (charge.missingRate) {
      warnings.push({
        code: 'fara_tarif_zona',
        message: `Zona ${charge.zone.code} nu are tarif valabil la ${date} pentru MMA ${mmaKg ?? '—'} kg`,
      });
    }
  }
  if (mmaKg == null && zones.length) {
    warnings.push({
      code: 'fara_mma',
      message: 'Vehiculul nu are MMA — taxele de zonă se calculează după MMA din talon, nu după marfă',
    });
  }

  // --- surcharges ----------------------------------------------------------
  for (const { type, rates, quantity } of surcharges) {
    const rate = findSurchargeRate(rates ?? [], { vehicleClass, onDate: date });
    if (!rate) {
      warnings.push({
        code: 'fara_tarif_taxa',
        message: `Taxa ${type.code} nu are tarif valabil la ${date}${vehicleClass ? ` pentru clasa ${vehicleClass}` : ''}`,
      });
      continue;
    }
    const qty = num(quantity, 1) || 1;
    lines.push({
      kind: 'surcharge',
      code: type.code,
      label: type.name,
      quantity: qty,
      unit_amount: num(rate.amount),
      amount: round2(num(rate.amount) * qty),
      currency: rate.currency || currency,
      source: 'auto',
      detail: { surcharge_type_id: type.id, vehicle_class: vehicleClass, applies_per: type.applies_per },
    });
  }

  // --- manual lines carried over ------------------------------------------
  for (const manual of trip.manual_charges ?? []) {
    lines.push({
      kind: 'manual',
      code: manual.code ?? null,
      label: manual.label ?? CHARGE_LABELS.manual,
      quantity: num(manual.quantity, 1),
      unit_amount: num(manual.unit_amount, manual.amount),
      amount: round2(manual.amount),
      currency: manual.currency || currency,
      source: 'manual',
      detail: manual.detail ?? null,
    });
  }

  const total = round2(lines.reduce((sum, line) => sum + num(line.amount), 0));

  return {
    lines,
    total,
    currency,
    warnings,
    basis: {
      on_date: date,
      vehicle_class: vehicleClass,
      normalised_class: normaliseClass(vehicleClass),
      mma_kg: mmaKg == null ? null : num(mmaKg),
      tariff_id: tariff?.id ?? null,
      distance_km: round2(kmSummary.distance_km),
      km_complete: kmSummary.complete !== false,
    },
  };
}

/** Groups charge lines by kind for a compact display. */
export function summariseCharges(lines = []) {
  const totals = {};
  for (const line of lines) {
    totals[line.kind] = round2(num(totals[line.kind]) + num(line.amount));
  }
  return totals;
}
