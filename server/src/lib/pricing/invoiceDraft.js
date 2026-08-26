/**
 * Building an invoice out of what the pricing engine actually computed.
 *
 * There used to be two money paths. The engine decomposed a trip into `trip_charges` — trip rate,
 * kilometres, zone tax, crane — and stored the total on the trip. The invoice draft ignored all
 * of that and summed `aviz_documents.valoare_tpo`, a column an operator can type into and OCR can
 * fill. The two could disagree, and nothing checked them against each other, so an invoice could
 * go out on a figure nothing had recalculated.
 *
 * The lines here come from the charges. When a trip has none, that is reported rather than
 * quietly replaced with the aviz column: an invoice built on a number of unknown origin is worse
 * than one that refuses to be built.
 */

function round2(value) {
  return Math.round((Number(value) || 0) * 100) / 100;
}

function toNumber(value) {
  if (value === null || value === undefined || value === '') return null;
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

/**
 * One invoice line per charge, carrying where it came from.
 *
 * The components stay separate all the way to the invoice, because that is what a customer
 * disputes: not "975 lei" but "why 120 for the crane".
 */
export function chargeLines(trip, charges = []) {
  return charges.map((charge) => ({
    trip_id: trip.id,
    charge_id: charge.id ?? null,
    kind: charge.kind,
    code: charge.code ?? null,
    label: charge.label,
    quantity: toNumber(charge.quantity),
    unit_amount: toNumber(charge.unit_amount),
    amount: round2(charge.amount),
    currency: charge.currency || 'RON',
    reference: trip.tpo_number || trip.cmr_number || null,
  }));
}

/**
 * A draft from a set of trips and their charges.
 *
 * @param {Array} trips     rows with `id`, `tpo_number`, `cmr_number`, `tpo_total`
 * @param {Map}   chargesByTrip  trip id -> charge rows
 * @param {object} options  `vatRate` (percent), `avizeByTrip` for the description
 */
export function buildInvoiceDraft(trips = [], chargesByTrip = new Map(), options = {}) {
  const vatRate = toNumber(options.vatRate) ?? 19;
  const lines = [];
  const warnings = [];
  const pricedTrips = [];
  const unpricedTrips = [];

  for (const trip of trips) {
    const charges = chargesByTrip.get(trip.id) ?? [];
    if (charges.length === 0) {
      unpricedTrips.push(trip);
      continue;
    }
    pricedTrips.push(trip);
    lines.push(...chargeLines(trip, charges));

    // The stored total and the lines must agree; they are the same claim written twice. A
    // mismatch here would be invoiced silently, so it is surfaced with both figures.
    const stored = toNumber(trip.tpo_total);
    const summed = round2(charges.reduce((sum, c) => sum + (Number(c.amount) || 0), 0));
    if (stored !== null && Math.abs(stored - summed) > 0.005) {
      warnings.push({
        code: 'tpo_total_mismatch',
        trip_id: trip.id,
        reference: trip.tpo_number || trip.cmr_number,
        message: `Totalul TPO stocat (${stored.toFixed(2)}) diferă de suma liniilor (${summed.toFixed(2)}). `
          + 'Recalculează TPO-ul înainte de a factura.',
      });
    }
  }

  if (unpricedTrips.length) {
    warnings.push({
      code: 'trip_not_priced',
      count: unpricedTrips.length,
      trip_ids: unpricedTrips.map((t) => t.id),
      message: `${unpricedTrips.length} cursă/curse nu au TPO calculat și nu pot intra pe factură. `
        + 'Calculează-le TPO-ul, apoi reia ciorna.',
    });
  }

  const subtotal = round2(lines.reduce((sum, line) => sum + line.amount, 0));
  const vatAmount = round2((subtotal * vatRate) / 100);

  return {
    lines,
    subtotal,
    vat_rate: vatRate,
    vat_amount: vatAmount,
    total_amount: round2(subtotal + vatAmount),
    currency: lines[0]?.currency || 'RON',
    warnings,
    priced_trip_ids: pricedTrips.map((t) => t.id),
    unpriced_trip_ids: unpricedTrips.map((t) => t.id),
  };
}

/**
 * Which trip the invoice header points at.
 *
 * One trip means the header can name it. Several means it cannot — pinning the invoice to
 * whichever happened to sort first is how a document ends up filed against the wrong trip, so it
 * is left unset and the lines carry the detail instead.
 */
export function headerTripId(tripIds = []) {
  const unique = [...new Set(tripIds.filter(Boolean))];
  return unique.length === 1 ? unique[0] : null;
}

/** The line a person reads on the invoice, naming what is being billed. */
export function describeDraft(trips = []) {
  const refs = trips.map((t) => t.tpo_number || t.cmr_number).filter(Boolean);
  if (!refs.length) return 'Servicii transport';
  if (refs.length <= 6) return `Servicii transport — ${refs.join(', ')}`;
  return `Servicii transport — ${refs.slice(0, 6).join(', ')} și încă ${refs.length - 6}`;
}

/**
 * VAT for the company's regime.
 *
 * A company that is not VAT-registered must not have 19% added to its invoices, which the old
 * hard-coded rate did to everyone.
 */
export function vatRateFor(company) {
  const regime = String(company?.vat_regime ?? 'platitor').toLowerCase();
  if (regime === 'neplatitor' || regime === 'scutit') return 0;
  const configured = toNumber(company?.vat_rate);
  return configured ?? 19;
}
