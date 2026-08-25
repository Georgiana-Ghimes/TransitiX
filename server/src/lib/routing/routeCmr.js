/**
 * CMR drafts from a planned route.
 *
 * A route is a plan; a CMR is a document. This module turns one into the other without
 * touching the database, so the mapping that actually matters — who is the shipper, who is
 * the consignee, which way round a pickup goes — is testable on its own.
 *
 * The direction is the whole point: on a delivery our company hands the goods over, so the
 * company is the shipper and the stop is the consignee. On a pickup it is the other way
 * round. Getting this backwards produces a document that is legally wrong, not just untidy.
 */

import { stripDiacritics } from '../geo/address.js';

const PAD = 2;

function text(value, max = 200) {
  if (value == null) return null;
  const trimmed = String(value).trim();
  return trimmed ? trimmed.slice(0, max) : null;
}

function fold(value) {
  return stripDiacritics(String(value ?? '')).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function titleCase(value) {
  return String(value).replace(/\p{L}+/gu, (word) => word[0].toUpperCase() + word.slice(1));
}

/**
 * The address as it must appear on a document.
 *
 * `locations.address` holds only the street, because the parser split the city and county
 * into their own columns. A CMR with a street and no town is not a delivery address, so the
 * parts are put back together — skipping any the street already contains.
 */
export function fullAddress(stop = {}) {
  const parts = [];
  const street = text(stop.address, 500);
  if (street) parts.push(street);

  const city = text(stop.city, 120);
  if (city && !fold(parts.join(' ')).includes(fold(city))) {
    parts.push(city === city.toLowerCase() ? titleCase(city) : city);
  }
  const county = text(stop.county, 64);
  if (county && !fold(parts.join(' ')).split(' ').includes(fold(county))) parts.push(county);

  return parts.length ? parts.join(', ').slice(0, 500) : null;
}

function num(value) {
  if (value == null || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/** `CMR-2026-0827-01`, continuing after whatever already exists for that day. */
export function nextCmrNumber(date, existingNumbers = [], offset = 0) {
  const iso = String(date || '').slice(0, 10);
  const match = iso.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  const prefix = `CMR-${match[1]}-${match[2]}${match[3]}-`;

  let max = 0;
  for (const number of existingNumbers) {
    const value = String(number || '');
    if (!value.startsWith(prefix)) continue;
    const tail = value.slice(prefix.length);
    if (!/^\d+$/.test(tail)) continue;
    max = Math.max(max, Number(tail));
  }
  return `${prefix}${String(max + 1 + offset).padStart(PAD, '0')}`;
}

/** Which stops become documents: the ones carrying an order. Depots and breaks do not. */
export function cmrEligibleStops(stops = []) {
  return stops.filter((stop) => stop.order_id && (stop.kind === 'livrare' || stop.kind === 'ridicare'));
}

function localDate(value) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function localTime(value) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

/**
 * The stop as a CMR party. Contact details come from the location first — that is the gate
 * the driver actually calls — and fall back to the client record.
 */
function stopParty(stop) {
  return {
    name: text(stop.location_name || stop.client_name || 'Destinatar'),
    address: text(stop.address_full, 500) || fullAddress(stop),
    cui: text(stop.client_cui, 32),
    contact: text(stop.contact_person),
    phone: text(stop.phone || stop.client_phone, 64),
    email: text(stop.client_email, 200),
  };
}

function companyParty(company) {
  return {
    name: text(company?.name || 'Firma'),
    address: text(company?.address, 500),
    cui: text(company?.cui, 32),
    contact: null,
    phone: text(company?.phone, 64),
    email: text(company?.email, 200),
  };
}

/**
 * One trip row per eligible stop.
 *
 * `skipStopIds` are stops that already produced a document — regenerating a route must add
 * the new stops without duplicating the CMRs already printed and handed to a driver.
 */
export function buildTripDrafts({
  route,
  stops = [],
  company = null,
  existingNumbers = [],
  skipStopIds = [],
} = {}) {
  if (!route) return [];
  const skip = new Set(skipStopIds);
  const eligible = cmrEligibleStops(stops).filter((stop) => !skip.has(stop.id));
  const us = companyParty(company);
  const routeDate = String(route.route_date || '').slice(0, 10) || null;
  const startsAt = String(route.starts_at || '08:00').slice(0, 5);

  return eligible.map((stop, index) => {
    const them = stopParty(stop);
    const pickup = stop.kind === 'ridicare';
    const shipper = pickup ? them : us;
    const consignee = pickup ? us : them;

    return {
      route_id: route.id,
      route_stop_id: stop.id,
      cmr_number: nextCmrNumber(routeDate, existingNumbers, index),
      driver_id: route.driver_id || null,
      vehicle_id: route.vehicle_id || null,
      driver_name: text(route.driver_name),
      vehicle_plate: text(route.vehicle_plate, 32),

      shipper_name: shipper.name,
      shipper_address: shipper.address,
      shipper_cui: shipper.cui,
      shipper_contact: shipper.contact,
      shipper_phone: shipper.phone,
      shipper_email: shipper.email,

      consignee_name: consignee.name,
      consignee_address: consignee.address,
      consignee_cui: consignee.cui,
      consignee_contact: consignee.contact,
      consignee_phone: consignee.phone,
      consignee_email: consignee.email,

      loading_date: routeDate,
      loading_time: startsAt,
      estimated_delivery_date: localDate(stop.planned_arrival) || routeDate,
      estimated_delivery_time: localTime(stop.planned_arrival),

      goods_description: text(stop.goods_description, 500),
      weight_kg: num(stop.weight_kg),
      volume_mc: num(stop.volume_mc),
      package_count: num(stop.pallets) == null ? null : Math.round(num(stop.pallets)),
      special_instructions: text(stop.notes || stop.order_notes, 500),
      internal_notes: `Generat din ruta ${route.code || ''} · oprirea ${stop.seq}${
        stop.order_number ? ` · comanda ${stop.order_number}` : ''
      }`.trim(),

      // Handing a document to a named driver is what makes the trip allocated; without one
      // it is still only a plan.
      status: route.driver_id ? 'alocata' : 'planificata',
    };
  });
}
