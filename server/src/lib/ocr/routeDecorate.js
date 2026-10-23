/**
 * The route a stored aviz shows on every read surface: the /avize list, the /avize annex export
 * and /reports (preview, export, invoice date). One function, so the same document cannot show
 * one route in the table and another in the customer's sheet.
 *
 * Order, same as at extract: the stored / repaired route → the company's learned origin and
 * delivery addresses when the page lost a street (#112) → a whole-route rule learned from an
 * office correction, which has the last word. A route the office pinned is left alone.
 *
 * Read-only: it decorates a response and writes nothing. The telemetry of this pass goes on
 * `extracted_data.route_trace_view`, next to (not over) the `route_trace` stored at extract.
 */

import { preferLearnedRoute } from './routeLearn.js';
import { applyAddressMemory, isAddressMemoryProfile } from './addressMemory.js';
import { buildRouteTrace, routeSourceOf } from './routeTrace.js';

/**
 * @param {object} serialized  a serialized row, already through `repairAvizFromStored`
 * @returns {{ ruta: string|null, extracted_data: object|null, trace: object }}
 */
export function routeWithCompanyMemory(serialized, { routeRules = [], knownAddresses = [] } = {}) {
  const corrected = Array.isArray(serialized.corrected_fields) ? serialized.corrected_fields : [];
  const raw = serialized.extracted_data?.raw_text;
  let ruta = serialized.ruta_transport;
  let extracted_data = serialized.extracted_data;
  const attempts = [];
  let memoryUsed = null;
  let rule = null;

  const pinned = corrected.includes('ruta_transport');
  if (pinned) {
    attempts.push({ step: 'address_memory', result: 'skipped', reason: 'corrected_fields_skip' });
    attempts.push({ step: 'route_rule', result: 'skipped', reason: 'corrected_fields_skip' });
  } else if (!raw) {
    attempts.push({ step: 'address_memory', result: 'skipped', reason: 'no_raw_text' });
  }

  if (raw && !pinned) {
    if (!knownAddresses.length) {
      attempts.push({ step: 'address_memory', result: 'skipped', reason: 'no_memory' });
    } else if (!isAddressMemoryProfile(serialized.ocr_profile_id)) {
      attempts.push({ step: 'address_memory', result: 'skipped', reason: 'profile_not_supported' });
    } else {
      const memory = applyAddressMemory({ ruta_transport: ruta }, raw, knownAddresses, { trace: attempts });
      if (memory.address || memory.deliveryAddresses.length) {
        memoryUsed = memory;
        ruta = memory.values.ruta_transport;
        extracted_data = {
          ...(extracted_data || {}),
          ...(memory.address ? { origin_source: 'memory', origin_address_id: memory.address.id } : {}),
          ...(memory.deliveryAddresses.length ? {
            delivery_source: 'memory',
            delivery_address_ids: memory.deliveryAddresses.map((a) => a.id),
          } : {}),
        };
      }
    }
    if (routeRules.length) {
      const learned = preferLearnedRoute(ruta, raw, routeRules, { corrected: false, trace: attempts });
      if (learned.rule) {
        rule = learned.rule;
        ruta = learned.route;
        extracted_data = {
          ...(extracted_data || {}),
          route_source: 'learned',
          origin_source: null,
          origin_address_id: null,
          delivery_source: null,
          delivery_address_ids: null,
        };
      }
    } else {
      attempts.push({ step: 'route_rule', result: 'skipped', reason: 'no_rules' });
    }
  }

  const trace = buildRouteTrace({
    context: 'decorate',
    attempts,
    source: routeSourceOf({ corrected: pinned, ruleUsed: Boolean(rule), memoryUsed: Boolean(memoryUsed), route: ruta }),
    originAddress: memoryUsed?.address || null,
    deliveryAddresses: memoryUsed?.deliveryAddresses || [],
    rule,
  });
  // A row typed in by hand has no extracted_data; it stays null rather than growing one.
  if (extracted_data) extracted_data = { ...extracted_data, route_trace_view: trace };
  return { ruta, extracted_data, trace };
}

/** A repaired row with its company route applied (export / reports rows). */
export function withCompanyRoute(repaired, context = {}) {
  const { ruta, extracted_data } = routeWithCompanyMemory(repaired, context);
  return { ...repaired, ruta_transport: ruta, extracted_data };
}
