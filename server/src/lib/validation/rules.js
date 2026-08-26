/**
 * Data-quality rules.
 *
 * Every rule here answers one question: would this row produce a wrong invoice, or a report a
 * customer cannot check? Nothing else belongs in this file. An alert that fires on something
 * merely untidy trains people to ignore the ones that matter, so a rule earns its place only by
 * naming a concrete consequence.
 *
 * The rules are pure functions over already-loaded rows. Fetching lives in `checks.js`, so a
 * rule can be tested against a hand-written row without a database.
 */
import { findTariff } from '../pricing/tariffs.js';

/** A finding severe enough to change an invoice, versus one worth a look. */
export const SEVERITIES = ['error', 'warning'];

/** Money is compared in bani — floating point makes 0.1 + 0.2 an alert otherwise. */
const MONEY_EPSILON = 0.005;

function toNumber(value) {
  if (value === null || value === undefined || value === '') return null;
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

function finding({ rule, severity, key, title, message, link, subject }) {
  return { rule, severity, key, title, message, link: link ?? null, subject };
}

function tripSubject(trip) {
  return {
    type: 'trip',
    id: trip.id,
    label: trip.tpo_number || trip.cmr_number || 'Cursă',
  };
}

/**
 * A document is identified by its file, not by its TPO.
 *
 * The TPO reads better, but it is a field on the document that may be missing or — as the
 * duplicate rule exists to catch — shared with another document. Two rows both labelled
 * "TPO 2026-0311" leave the operator no way to tell which one to open.
 */
function documentSubject(doc) {
  return {
    type: 'document',
    id: doc.id,
    label: doc.original_filename || doc.numar_tpo || 'Document',
  };
}

/**
 * A trip billed against a contract with no tariff valid on its own date.
 *
 * This is the expensive one. The TPO still calculates, still looks like a number, and simply
 * has no transport line in it — so the trip goes out under-billed and nobody finds out until
 * someone compares an invoice against the contract.
 *
 * The match uses the same `findTariff` the calculation uses. Reimplementing the lookup here
 * would let the alert and the invoice disagree, which is worse than having no alert.
 */
export function checkTripTariff(trip, tariffs) {
  if (!trip.contract_id) return null;
  // The same date the calculation reads rates as of. pg hands DATE back as a Date object.
  const onDate = trip.loading_date instanceof Date
    ? trip.loading_date.toISOString().slice(0, 10)
    : String(trip.loading_date ?? '').slice(0, 10);
  if (!onDate) return null;
  const matched = findTariff(tariffs ?? [], { vehicleClass: trip.vehicle_class, onDate });
  if (matched) return null;
  return finding({
    rule: 'trip_no_tariff',
    severity: 'error',
    key: `trip_no_tariff:${trip.id}`,
    title: `Fără tarif valabil — ${trip.tpo_number || trip.cmr_number || 'cursă'}`,
    message: trip.vehicle_class
      ? `Nu există tarif pentru clasa „${trip.vehicle_class}” valabil la ${onDate}. `
        + 'Cursa se va calcula fără linia de transport.'
      : `Cursa nu are clasă de vehicul, deci nu i se poate găsi tarif la ${onDate}.`,
    link: `/trips/${trip.id}`,
    subject: tripSubject(trip),
  });
}

/**
 * A TPO total that is not the sum of its lines.
 *
 * The total is only ever the sum of the charge rows. If they have drifted apart, one of the two
 * was edited on its own and the document no longer explains its own figure.
 */
export function checkTpoTotal(trip) {
  const total = toNumber(trip.tpo_total);
  if (total === null) return null;
  const lines = toNumber(trip.charges_total) ?? 0;
  if (Math.abs(total - lines) <= MONEY_EPSILON) return null;
  return finding({
    rule: 'tpo_total_mismatch',
    severity: 'error',
    key: `tpo_total_mismatch:${trip.id}`,
    title: `Total TPO diferit de suma liniilor — ${trip.tpo_number || trip.cmr_number || 'cursă'}`,
    message: `Totalul este ${total.toFixed(2)}, suma liniilor ${lines.toFixed(2)}. `
      + 'Recalculează TPO-ul sau verifică liniile adăugate manual.',
    link: `/trips/${trip.id}`,
    subject: tripSubject(trip),
  });
}

/**
 * A calculated TPO with no distance behind it.
 *
 * Only for trips that already have a TPO: a trip nobody has priced yet is not a problem, it is
 * simply not done. One that has been priced without kilometres is missing a whole component.
 */
export function checkTripDistance(trip) {
  if (toNumber(trip.tpo_total) === null) return null;
  if (toNumber(trip.distance_km) !== null) return null;
  return finding({
    rule: 'trip_no_distance',
    severity: 'warning',
    key: `trip_no_distance:${trip.id}`,
    title: `TPO fără kilometri — ${trip.tpo_number || trip.cmr_number || 'cursă'}`,
    message: 'Cursa a fost calculată fără distanță, deci fără componenta de kilometri. '
      + 'Verifică dacă rutarea este configurată.',
    link: `/trips/${trip.id}`,
    subject: tripSubject(trip),
  });
}

/**
 * A TPO calculated before the trip was last changed.
 *
 * Someone edited the trip after pricing it. The stored total may still be right, but nothing
 * guarantees it, and a stale figure that looks current is exactly what gets invoiced.
 */
export function checkTpoStale(trip) {
  if (!trip.tpo_calculated_at || !trip.updated_at) return null;
  const calculated = new Date(trip.tpo_calculated_at);
  const updated = new Date(trip.updated_at);
  if (Number.isNaN(calculated.getTime()) || Number.isNaN(updated.getTime())) return null;
  // A second of slack: the calculation itself touches the row.
  if (updated.getTime() - calculated.getTime() <= 1000) return null;
  return finding({
    rule: 'tpo_stale',
    severity: 'warning',
    key: `tpo_stale:${trip.id}:${updated.toISOString()}`,
    title: `TPO recalculabil — ${trip.tpo_number || trip.cmr_number || 'cursă'}`,
    message: 'Cursa a fost modificată după ultimul calcul de TPO.',
    link: `/trips/${trip.id}`,
    subject: tripSubject(trip),
  });
}

/**
 * A confirmed aviz with no weighing.
 *
 * Confirmed means a person looked at it. If the weight is still missing after that, the report
 * built from it cannot be reconciled against the weighbridge ticket — which is the whole reason
 * the client asked for the column.
 */
export function checkDocumentWeight(doc) {
  if (doc.status !== 'confirmed') return null;
  if (toNumber(doc.gross_weight_kg) !== null) return null;
  return finding({
    rule: 'document_no_weight',
    severity: 'warning',
    key: `document_no_weight:${doc.id}`,
    title: `Aviz confirmat fără greutate — ${doc.numar_tpo || doc.original_filename || 'document'}`,
    message: 'Documentul a fost confirmat fără greutate brută, deci raportul nu poate fi '
      + 'confruntat cu bonul de cântar.',
    link: '/reports',
    subject: documentSubject(doc),
  });
}

/** A confirmed aviz attached to no trip will never reach an invoice. */
export function checkDocumentLinked(doc) {
  if (doc.status !== 'confirmed') return null;
  if (doc.trip_id) return null;
  return finding({
    rule: 'document_unlinked',
    severity: 'warning',
    key: `document_unlinked:${doc.id}`,
    title: `Aviz nelegat de cursă — ${doc.numar_tpo || doc.original_filename || 'document'}`,
    message: 'Documentul este confirmat dar nu aparține niciunei curse, deci nu va fi facturat.',
    link: '/reports',
    subject: documentSubject(doc),
  });
}

/**
 * The same TPO number on more than one document.
 *
 * One finding per number, not per document: the operator has one thing to resolve, not three.
 */
export function checkDuplicateTpo(documents = []) {
  const byTpo = new Map();
  for (const doc of documents) {
    const tpo = String(doc.numar_tpo || '').trim().toLowerCase();
    if (!tpo) continue;
    byTpo.set(tpo, [...(byTpo.get(tpo) ?? []), doc]);
  }
  const found = [];
  for (const [tpo, docs] of byTpo) {
    if (docs.length < 2) continue;
    found.push(finding({
      rule: 'document_duplicate_tpo',
      severity: 'warning',
      key: `document_duplicate_tpo:${tpo}`,
      title: `TPO pe mai multe documente — ${docs[0].numar_tpo}`,
      message: `${docs.length} documente poartă același număr de TPO: `
        + `${docs.map((d) => d.original_filename || d.id).join(', ')}.`,
      link: '/reports',
      subject: { type: 'tpo', id: tpo, label: docs[0].numar_tpo },
    }));
  }
  return found;
}

/**
 * A delivered trip whose written CMR was never closed.
 *
 * Only for notes that were actually started. A company that runs on paper CMRs has no digital
 * note at all, and firing on every one of their trips would make the screen useless to them —
 * an abandoned half-signed note is the unambiguous case, and it means the handover has no proof.
 */
export function checkCmrUnsigned(trip) {
  if (trip.cmr_source !== 'digital') return null;
  if (trip.status !== 'livrata') return null;
  if (trip.cmr_signed_delivery_at) return null;
  const atLoading = Boolean(trip.cmr_signed_loading_at);
  return finding({
    rule: 'cmr_unsigned',
    severity: 'warning',
    key: `cmr_unsigned:${trip.id}`,
    title: `CMR nesemnat la livrare — ${trip.cmr_number || trip.tpo_number || 'cursă'}`,
    message: atLoading
      ? 'Cursa este livrată, dar destinatarul nu a semnat CMR-ul digital.'
      : 'Cursa este livrată, dar CMR-ul digital a rămas ciornă — nesemnat de nimeni.',
    link: `/trips/${trip.id}`,
    subject: tripSubject(trip),
  });
}

/** Runs every trip rule. `tariffsFor` returns the contract's tariff rows for a trip. */
export function checkTrip(trip, tariffsFor = () => []) {
  return [
    checkTripTariff(trip, tariffsFor(trip)),
    checkTpoTotal(trip),
    checkTripDistance(trip),
    checkTpoStale(trip),
    checkCmrUnsigned(trip),
  ].filter(Boolean);
}

export function checkDocument(doc) {
  return [checkDocumentWeight(doc), checkDocumentLinked(doc)].filter(Boolean);
}

const SEVERITY_ORDER = { error: 0, warning: 1 };

/** Errors first, then by rule, so the list reads in the order things should be fixed. */
export function sortFindings(findings = []) {
  return [...findings].sort((a, b) => {
    const bySeverity = (SEVERITY_ORDER[a.severity] ?? 9) - (SEVERITY_ORDER[b.severity] ?? 9);
    if (bySeverity !== 0) return bySeverity;
    return a.rule.localeCompare(b.rule) || String(a.key).localeCompare(String(b.key));
  });
}

/** Counts per rule and per severity, for the badge and the summary line. */
export function summariseFindings(findings = []) {
  const byRule = {};
  const bySeverity = { error: 0, warning: 0 };
  for (const item of findings) {
    byRule[item.rule] = (byRule[item.rule] ?? 0) + 1;
    if (bySeverity[item.severity] !== undefined) bySeverity[item.severity] += 1;
  }
  return { total: findings.length, by_rule: byRule, by_severity: bySeverity };
}
