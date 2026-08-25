/**
 * Turns the addresses already scattered across `clients` and `trips` into `locations` rows.
 *
 * Pure planning only — no database access — so the whole decision path (what becomes a
 * location, what collapses into an existing one, what the data-quality report says) is
 * testable without a live Postgres. `server/src/backfill-locations.js` supplies the IO.
 */

import { addressKey, assessAddress } from './address.js';

/** Normalized company name, used to attach a trip party to an existing client record. */
function nameKey(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/\b(s\.?c\.?|s\.?r\.?l\.?|s\.?a\.?|p\.?f\.?a\.?|srl|sa)\b/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function cuiKey(value) {
  const digits = String(value || '').replace(/\D/g, '');
  return digits || null;
}

/** Index of existing clients, so trip parties resolve to a client_id where possible. */
export function indexClients(clients = []) {
  const byCui = new Map();
  const byName = new Map();
  for (const client of clients) {
    const cui = cuiKey(client.cui);
    if (cui && !byCui.has(cui)) byCui.set(cui, client.id);
    const name = nameKey(client.name);
    if (name && !byName.has(name)) byName.set(name, client.id);
  }
  return { byCui, byName };
}

export function matchClientId(index, { name, cui } = {}) {
  const cuiHit = cuiKey(cui);
  if (cuiHit && index.byCui.has(cuiHit)) return index.byCui.get(cuiHit);
  const nameHit = nameKey(name);
  if (nameHit && index.byName.has(nameHit)) return index.byName.get(nameHit);
  return null;
}

export function candidatesFromClients(clients = []) {
  const out = [];
  for (const client of clients) {
    if (!client.address || !String(client.address).trim()) continue;
    out.push({
      source: 'client',
      source_id: client.id,
      client_id: client.id,
      kind: 'client',
      name: client.name || 'Client fără nume',
      address: client.address,
      contact_person: client.contact_person || null,
      phone: client.phone || null,
    });
  }
  return out;
}

export function candidatesFromTrips(trips = [], clientIndex = indexClients([])) {
  const out = [];
  for (const trip of trips) {
    const parties = [
      {
        role: 'shipper',
        name: trip.shipper_name,
        address: trip.shipper_address,
        cui: trip.shipper_cui,
        contact: trip.shipper_contact,
        phone: trip.shipper_phone,
      },
      {
        role: 'consignee',
        name: trip.consignee_name,
        address: trip.consignee_address,
        cui: trip.consignee_cui,
        contact: trip.consignee_contact,
        phone: trip.consignee_phone,
      },
    ];
    for (const party of parties) {
      if (!party.address || !String(party.address).trim()) continue;
      out.push({
        source: `trip_${party.role}`,
        source_id: trip.id,
        client_id: matchClientId(clientIndex, { name: party.name, cui: party.cui }),
        kind: 'client',
        name: party.name || `Adresă ${party.role}`,
        address: party.address,
        contact_person: party.contact || null,
        phone: party.phone || null,
      });
    }
  }
  return out;
}

/** Attaches the parsed address, dedupe key and quality assessment to each candidate. */
export function assessCandidates(candidates = []) {
  return candidates.map((candidate) => {
    const assessment = assessAddress(candidate.address);
    return {
      ...candidate,
      address_key: addressKey(assessment.parsed),
      parsed: assessment.parsed,
      score: assessment.score,
      tier: assessment.tier,
      flags: assessment.flags,
    };
  });
}

/**
 * Collapses candidates that resolve to the same physical address.
 *
 * A client record wins over a trip party for the surviving name, because clients are
 * maintained by hand and trip parties are whatever was typed onto a CMR that day. When
 * neither has a client_id the first non-null one found across duplicates is kept.
 */
export function dedupeCandidates(assessed = [], { existingKeys = new Set() } = {}) {
  const unique = new Map();
  let skippedExisting = 0;
  let merged = 0;
  let unusable = 0;

  for (const candidate of assessed) {
    if (!candidate.address_key) {
      unusable += 1;
      continue;
    }
    if (existingKeys.has(candidate.address_key)) {
      skippedExisting += 1;
      continue;
    }
    const seen = unique.get(candidate.address_key);
    if (!seen) {
      unique.set(candidate.address_key, { ...candidate, sources: [candidate.source] });
      continue;
    }
    merged += 1;
    seen.sources.push(candidate.source);
    if (!seen.client_id && candidate.client_id) seen.client_id = candidate.client_id;
    if (seen.source !== 'client' && candidate.source === 'client') {
      seen.name = candidate.name;
      seen.source = 'client';
    }
    if (!seen.contact_person && candidate.contact_person) seen.contact_person = candidate.contact_person;
    if (!seen.phone && candidate.phone) seen.phone = candidate.phone;
  }

  return { rows: [...unique.values()], merged, skippedExisting, unusable };
}

/** Maps a deduped candidate onto the `locations` column set. */
export function toLocationRow(candidate, companyId) {
  return {
    company_id: companyId,
    client_id: candidate.client_id || null,
    name: String(candidate.name || '').slice(0, 200),
    kind: candidate.kind || 'client',
    address: candidate.parsed.street || candidate.address,
    city: candidate.parsed.city,
    county: candidate.parsed.county,
    postcode: candidate.parsed.postcode,
    country: 'RO',
    address_key: candidate.address_key,
    contact_person: candidate.contact_person,
    phone: candidate.phone,
    // No coordinates yet — geocoding is the next step, and an invented pin is worse than none.
    geocode_source: 'import',
    geocode_verified: false,
  };
}

/** The data-quality report: the whole point of running this before wiring up a geocoder. */
export function summarize(assessed = [], dedupe = null) {
  const byTier = { good: 0, review: 0, poor: 0 };
  const byFlag = {};
  const bySource = {};
  const byCounty = {};

  for (const candidate of assessed) {
    byTier[candidate.tier] = (byTier[candidate.tier] || 0) + 1;
    bySource[candidate.source] = (bySource[candidate.source] || 0) + 1;
    for (const flag of candidate.flags) byFlag[flag] = (byFlag[flag] || 0) + 1;
    const county = candidate.parsed.county || '—';
    byCounty[county] = (byCounty[county] || 0) + 1;
  }

  const scores = assessed.map((c) => c.score);
  const averageScore = scores.length
    ? Math.round((scores.reduce((a, b) => a + b, 0) / scores.length) * 100) / 100
    : 0;

  return {
    candidates: assessed.length,
    unique: dedupe ? dedupe.rows.length : null,
    merged: dedupe ? dedupe.merged : null,
    skippedExisting: dedupe ? dedupe.skippedExisting : null,
    unusable: dedupe ? dedupe.unusable : null,
    averageScore,
    byTier,
    byFlag,
    bySource,
    byCounty,
  };
}
