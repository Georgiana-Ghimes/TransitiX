/**
 * Route telemetry: how one aviz got its `ruta_transport`, and why every learned shortcut that was
 * tried did not apply.
 *
 * Observability only. Nothing here decides a route; addressMemory / routeLearn push one entry per
 * attempt into a plain array (`trace`) and this module folds it into the object stored on
 * `extracted_data.route_trace` at extract, or shown as `extracted_data.route_trace_view` when the
 * list / export / report decorates a row.
 *
 * Kept free of personal data on purpose: ids of learned addresses and rules, reason codes,
 * counts and similarity scores. No street, no postcode, no raw text.
 */

export const ROUTE_TRACE_VERSION = 1;

/**
 * Where the route finally came from:
 *   corrected  the office pinned it (corrected_fields)
 *   rule       a whole-route rule learned from an Editează correction
 *   memory     a learned origin / delivery address filled an unreadable street
 *   parser     the structural parse of this page (or the stored value, repaired)
 *   none       no route at all
 */
export function routeSourceOf({ corrected = false, ruleUsed = false, memoryUsed = false, route = null } = {}) {
  if (corrected) return 'corrected';
  if (ruleUsed) return 'rule';
  if (memoryUsed) return 'memory';
  return String(route ?? '').trim() ? 'parser' : 'none';
}

/**
 * @param {object} p
 * @param {'extract'|'decorate'} p.context
 * @param {object[]} p.attempts          entries pushed by addressMemory / routeLearn
 * @param {string} p.source              see {@link routeSourceOf}
 * @param {object|null} [p.originAddress]
 * @param {object[]} [p.deliveryAddresses]
 * @param {object|null} [p.rule]
 */
export function buildRouteTrace({
  context,
  attempts = [],
  source,
  originAddress = null,
  deliveryAddresses = [],
  rule = null,
} = {}) {
  const refused = {};
  for (const a of attempts) {
    if (a?.result === 'refused' && a.reason) refused[a.reason] = (refused[a.reason] || 0) + 1;
  }
  // A memory fill that a learned rule then replaced: the trace says so instead of losing it.
  const overridden = source === 'rule' && (originAddress || deliveryAddresses.length);
  return {
    v: ROUTE_TRACE_VERSION,
    context,
    source,
    rule_id: source === 'rule' ? rule?.id ?? null : null,
    origin_address_id: source === 'memory' ? originAddress?.id ?? null : null,
    delivery_address_ids: source === 'memory' && deliveryAddresses.length
      ? deliveryAddresses.map((a) => a.id ?? null)
      : [],
    ...(overridden ? { memory_overridden_by_rule: true } : {}),
    refused,
    attempts: attempts.map((a) => ({ ...a })),
  };
}

/** Compact form for `document_events.detail`: enough to aggregate reasons across a batch. */
export function routeTraceEventDetail(trace) {
  if (!trace) return null;
  return {
    source: trace.source,
    refused: trace.refused,
    ...(trace.rule_id ? { rule_id: trace.rule_id } : {}),
    ...(trace.origin_address_id ? { origin_address_id: trace.origin_address_id } : {}),
    ...(trace.delivery_address_ids?.length ? { delivery_address_ids: trace.delivery_address_ids } : {}),
  };
}
