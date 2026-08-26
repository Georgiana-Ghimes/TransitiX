/**
 * The digital CMR.
 *
 * A driver could already photograph a paper CMR. This is the other case: there is no paper, and
 * the consignment note has to be written. It is the same document either way, so it lands in the
 * same `trip_documents` row — `source` says which, and there is never a second place claiming to
 * hold "the CMR for this trip".
 *
 * The form is not twenty-four empty boxes on a phone. Most of a CMR is already known to the TMS
 * before the truck leaves; the driver is asked only for what only the driver can see — what was
 * actually loaded, what it weighed, and what was wrong with it.
 */

/**
 * `stage` says when a box is filled: at loading, at delivery, or known in advance.
 * `required` means the CMR cannot be signed for that stage without it.
 */
export const CMR_BOXES = [
  { box: 1, id: 'expeditor', label: 'Expeditor', stage: 'prefill', multiline: true },
  { box: 2, id: 'destinatar', label: 'Destinatar', stage: 'prefill', multiline: true },
  { box: 3, id: 'loc_livrare', label: 'Locul livrării mărfii', stage: 'prefill', multiline: true },
  { box: 4, id: 'loc_data_incarcare', label: 'Locul și data încărcării', stage: 'prefill', multiline: true },
  { box: 5, id: 'documente_anexate', label: 'Documente anexate', stage: 'incarcare' },
  { box: 6, id: 'marci_si_numere', label: 'Mărci și numere', stage: 'incarcare' },
  { box: 7, id: 'numar_colete', label: 'Număr de colete', stage: 'incarcare', type: 'integer', required: true },
  { box: 8, id: 'mod_ambalare', label: 'Mod de ambalare', stage: 'incarcare' },
  { box: 9, id: 'natura_marfii', label: 'Natura mărfii', stage: 'incarcare', required: true },
  { box: 10, id: 'cod_nhm', label: 'Nr. statistic (NHM)', stage: 'incarcare' },
  // The figure the rest of the system is built on: weighbridge, TPO, the customer's report.
  // A consignment note without it is not a usable transport document.
  { box: 11, id: 'greutate_bruta_kg', label: 'Greutate brută (kg)', stage: 'incarcare', type: 'number', required: true },
  { box: 12, id: 'volum_mc', label: 'Volum (m³)', stage: 'incarcare', type: 'number' },
  { box: 13, id: 'instructiuni_expeditor', label: 'Instrucțiunile expeditorului', stage: 'incarcare', multiline: true },
  { box: 16, id: 'transportator', label: 'Transportator', stage: 'prefill', multiline: true },
  { box: 17, id: 'transportatori_succesivi', label: 'Transportatori succesivi', stage: 'incarcare', multiline: true },
  // Box 18 is the one that matters when something goes wrong: it is where the driver records
  // damage or shortage found at loading or at handover. Everything else is bookkeeping.
  { box: 18, id: 'rezerve_incarcare', label: 'Rezerve și observații la încărcare', stage: 'incarcare', multiline: true },
  { box: 18, id: 'rezerve_livrare', label: 'Rezerve și observații la livrare', stage: 'livrare', multiline: true },
  { box: 19, id: 'conventii_speciale', label: 'Convenții speciale', stage: 'incarcare', multiline: true },
  { box: 21, id: 'intocmit_la', label: 'Întocmit la', stage: 'prefill' },
  { box: 21, id: 'intocmit_data', label: 'Data întocmirii', stage: 'prefill', type: 'date' },
];

export const SIGNATURES = [
  { box: 22, id: 'semnatura_expeditor', label: 'Semnătura expeditorului', stage: 'incarcare', required: true },
  { box: 23, id: 'semnatura_transportator', label: 'Semnătura transportatorului', stage: 'incarcare', required: true },
  { box: 24, id: 'semnatura_destinatar', label: 'Semnătura destinatarului', stage: 'livrare', required: true },
];

export const STAGES = ['incarcare', 'livrare'];

const BY_ID = new Map(CMR_BOXES.map((b) => [b.id, b]));

export function getBox(id) {
  return BY_ID.get(String(id || '')) || null;
}

/** Field ids a client is allowed to write. Anything else in a payload is ignored. */
export const WRITABLE_FIELDS = CMR_BOXES.map((b) => b.id);

function joinLines(...parts) {
  return parts.map((p) => String(p ?? '').trim()).filter(Boolean).join('\n') || null;
}

/**
 * Local calendar date, so a midnight-UTC DATE does not slip to the previous day.
 *
 * pg hands a DATE back as local midnight; `toISOString()` on that lands in the previous evening
 * anywhere east of Greenwich, and the consignment note would carry the day before the load.
 */
function formatLocalDate(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function isoDate(value) {
  if (!value) return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : formatLocalDate(value);
  const text = String(value).slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : null;
}

/**
 * What the TMS already knows.
 *
 * Handing a driver a blank consignment note when the office typed the shipper and consignee an
 * hour ago is how you get a CMR that disagrees with the order it came from.
 */
export function prefillFromTrip(trip = {}, company = {}) {
  // Run through the same coercion the write path uses. pg returns NUMERIC columns as strings,
  // so a weight read straight off the trip would land in the box as "9000.00" — shown that way
  // on the form and stored that way in the note.
  return sanitiseCmr({
    expeditor: joinLines(trip.shipper_name, trip.shipper_address),
    destinatar: joinLines(trip.consignee_name, trip.consignee_address),
    loc_livrare: joinLines(trip.consignee_address || trip.consignee_name),
    loc_data_incarcare: joinLines(trip.shipper_address || trip.shipper_name, isoDate(trip.loading_date)),
    transportator: joinLines(company.name, company.address, company.cui ? `CUI ${company.cui}` : null),
    natura_marfii: trip.goods_description ?? null,
    greutate_bruta_kg: trip.gross_weight_kg ?? trip.weight_kg ?? null,
    numar_colete: trip.package_count ?? null,
    volum_mc: trip.volume_mc ?? null,
    intocmit_la: company.city ?? null,
    intocmit_data: isoDate(trip.loading_date) ?? formatLocalDate(new Date()),
  });
}

function coerce(box, value) {
  if (value === null || value === undefined || value === '') return null;
  if (box.type === 'integer') {
    const num = Number.parseInt(String(value).replace(/\s/g, ''), 10);
    return Number.isFinite(num) ? num : null;
  }
  if (box.type === 'number') {
    const num = Number(String(value).replace(/\s/g, '').replace(',', '.'));
    return Number.isFinite(num) ? num : null;
  }
  if (box.type === 'date') return isoDate(value);
  return String(value).slice(0, 2000);
}

/** Keeps only known fields, in the declared type. Junk in a payload never reaches the document. */
export function sanitiseCmr(input = {}) {
  const out = {};
  for (const box of CMR_BOXES) {
    if (!(box.id in input)) continue;
    out[box.id] = coerce(box, input[box.id]);
  }
  return out;
}

/**
 * Prefill under the saved draft.
 *
 * A value the driver typed always wins, including a deliberate blank — re-applying the prefill
 * over a cleared box would silently undo the correction.
 */
export function mergeCmr(prefill = {}, saved = null) {
  if (!saved) return { ...prefill };
  const merged = { ...prefill };
  for (const [key, value] of Object.entries(saved)) {
    if (value !== undefined) merged[key] = value;
  }
  return merged;
}

function isBlank(value) {
  return value === null || value === undefined || String(value).trim() === '';
}

/**
 * What is still missing before this stage can be signed.
 *
 * Signatures are checked alongside the boxes, because a consignment note signed with the weight
 * box empty is worth no more than no consignment note at all.
 */
export function validateCmr(data = {}, { stage = 'incarcare', signatures = {} } = {}) {
  const missing = [];
  for (const box of CMR_BOXES) {
    if (box.stage !== stage || !box.required) continue;
    if (isBlank(data[box.id])) missing.push({ id: box.id, box: box.box, label: box.label });
  }
  for (const sig of SIGNATURES) {
    if (sig.stage !== stage || !sig.required) continue;
    if (isBlank(signatures[sig.id])) missing.push({ id: sig.id, box: sig.box, label: sig.label });
  }
  return { ok: missing.length === 0, missing };
}

/** How much of the note is written, for a progress line on the driver's screen. */
export function cmrCompleteness(data = {}, stage = null) {
  const boxes = stage ? CMR_BOXES.filter((b) => b.stage === stage) : CMR_BOXES;
  const filled = boxes.filter((b) => !isBlank(data[b.id])).length;
  return { filled, total: boxes.length };
}

/** The boxes for one stage, in box order, as the form renders them. */
export function boxesForStage(stage) {
  return CMR_BOXES.filter((b) => b.stage === stage).sort((a, b) => a.box - b.box);
}

/**
 * Whether a trip already has enough of a paper trail that a digital note would duplicate it.
 * A scan and a written note are both "the CMR"; having both invites two different truths.
 */
export function conflictsWithScan(document) {
  return Boolean(document?.original_image_url) && document?.source !== 'digital';
}
