/**
 * Who changed what.
 *
 * `document_events` already explained a corrected aviz. Nothing explained a tariff that moved,
 * a depot that changed — which silently changes every billable kilometre afterwards — or a trip
 * edited after it had been invoiced. Those are the questions asked months later, usually by
 * somebody who was not in the room, and until now the honest answer was "the database does not
 * know".
 *
 * Two rules shape this file:
 *
 * 1. **Not everything is audited.** A row per GPS ping would bury the six entries that matter
 *    under a million that do not, and would undo the retention work in a week. The list below is
 *    explicit and each entry says why it is on it.
 * 2. **Only what actually changed is stored.** A full row snapshot on every save buries the one
 *    field somebody edited. For a delete the whole row is kept, because nothing else will have it.
 */

/**
 * Entities whose history is worth keeping, and the reason.
 *
 * The reason is not decoration: it is the test somebody must pass before adding a row here.
 * If you cannot say who would ask the question, the entry does not belong.
 */
export const AUDITED_ENTITIES = {
  Contract: 'Contractul comercial în baza căruia se facturează.',
  ContractTariff: 'Tariful. Cine l-a schimbat și de când e cea mai scumpă întrebare din sistem.',
  TaxZone: 'Definiția zonei care intră în preț.',
  TaxZoneRate: 'Taxa de zonă — component direct în TPO.',
  SurchargeType: 'Definiția unei taxe suplimentare.',
  SurchargeRate: 'Valoarea taxei suplimentare facturate.',
  ObservationCode: 'Codurile clientului; un import greșit se vede în toate avizele.',
  Location: 'Coordonatele decid kilometrii facturabili.',
  Client: 'Datele de facturare ale clientului.',
  Vehicle: 'Clasa comercială decide tariful; MMA decide legalitatea.',
  Driver: 'Cine conduce și din ce dată — contează la orice reconstituire a unei curse.',
  Trip: 'Cursa. Editarea ei după facturare e exact ce trebuie explicat.',
  TripCharge: 'Componentele TPO — din ele se face factura.',
  TripLeg: 'Etapele din care ies kilometrii facturabili.',
  Invoice: 'Document fiscal emis; o modificare după emitere trebuie explicată.',
  ReportTemplate: 'Forma în care pleacă raportul la client.',
  Territory: 'Împărțirea pe zone decide ce taxă de zonă se aplică.',
  Order: 'Ce a cerut clientul, față de ce s-a executat.',
  WarehouseProduct: 'Cantitățile din depozit; o corecție de stoc fără autor nu se poate verifica.',
};

/**
 * Deliberately not audited, and why — so the next person does not add them by reflex.
 *
 * These are either high-volume telemetry or already covered by a better, purpose-built trail.
 */
export const NOT_AUDITED = {
  GPSLog: 'Un rând per ping. Ar îngropa restul jurnalului.',
  ChatMessage: 'Mesajul însuși e înregistrarea.',
  DriverNotification: 'Efect, nu decizie.',
  OptimizationSuggestion: 'Generat automat, nu de un om.',
  AvizDocument: 'Are deja document_events, cu detaliu per câmp OCR.',
  DocumentBatch: 'La fel — document_events.',
  DocumentEvent: 'Este el însuși jurnal.',
  TripDocument: 'Încărcările și semnăturile au propriul traseu.',
  ClientConfirmation: 'Confirmarea e propria ei dovadă.',
  Route: 'Recalculat des și automat.',
  RouteStop: 'La fel ca ruta.',
};

export function isAudited(entity) {
  return Object.prototype.hasOwnProperty.call(AUDITED_ENTITIES, entity);
}

/**
 * Fields whose value must never land in the trail, matched by pattern rather than by a list.
 *
 * A hand-maintained list of names where a pattern belongs is a recurring bug in this codebase —
 * it was how a date column stopped being formatted as a date. Here the cost of missing one is a
 * password hash written to a table built to be read by people, so the pattern errs wide: an
 * over-redacted field is a small annoyance, a leaked one is not.
 */
const SECRET_FIELD = /pass|token|secret|hash|api[_-]?key|credential|signature/i;

/** Values longer than this are recorded as a marker; the trail is for reading, not for blobs. */
const MAX_VALUE_CHARS = 500;

/** Changing these says nothing about intent. */
const NOISE_FIELDS = new Set(['updated_at', 'created_at', 'id', 'company_id']);

export function isSecretField(field) {
  return SECRET_FIELD.test(field);
}

/**
 * Turns a stored value into something comparable and printable.
 *
 * pg hands back `Date` objects for timestamps and **strings** for NUMERIC, so a tariff saved as
 * 2.5 comes back as "2.5000" — compared naively, every save of an untouched row would look like
 * a change.
 */
export function normaliseValue(value) {
  if (value == null) return null;
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'object') return JSON.stringify(value);
  return value;
}

/** True when two stored values mean the same thing, numeric string formatting included. */
export function sameValue(a, b) {
  const left = normaliseValue(a);
  const right = normaliseValue(b);
  if (left === right) return true;
  if (left == null || right == null) return false;
  const ln = Number(left);
  const rn = Number(right);
  // Both sides must actually be numbers: "10t" and "10" are different vehicle classes, and
  // Number('') is 0, which would make an emptied field look unchanged.
  if (Number.isFinite(ln) && Number.isFinite(rn)
      && String(left).trim() !== '' && String(right).trim() !== '') {
    return ln === rn;
  }
  return false;
}

/** What gets written for one value: redacted, truncated, or itself. */
export function presentValue(field, value) {
  if (isSecretField(field)) return '«ascuns»';
  const normalised = normaliseValue(value);
  if (typeof normalised === 'string' && normalised.length > MAX_VALUE_CHARS) {
    return `«${normalised.length} caractere»`;
  }
  return normalised;
}

/**
 * The fields that actually differ, as `{ field: { from, to } }`.
 *
 * Driven off the rows themselves rather than off the request payload, so a value the server
 * derived — `distance_source`, an allocated invoice number — shows up too. Sending a field
 * unchanged produces no entry at all, which is why an empty result means "nothing happened"
 * rather than "nothing was submitted".
 */
export function diffRows(before, after) {
  const changes = {};
  const fields = new Set([...Object.keys(before || {}), ...Object.keys(after || {})]);
  for (const field of fields) {
    if (NOISE_FIELDS.has(field)) continue;
    const from = before?.[field];
    const to = after?.[field];
    if (sameValue(from, to)) continue;
    changes[field] = { from: presentValue(field, from), to: presentValue(field, to) };
  }
  return changes;
}

/** A whole row, redacted and truncated — for a delete, where nothing else will hold it. */
export function snapshotRow(row) {
  const out = {};
  for (const [field, value] of Object.entries(row || {})) {
    if (field === 'company_id') continue;
    out[field] = presentValue(field, value);
  }
  return out;
}

/**
 * A name a person recognises, captured at the time.
 *
 * Storing it beats joining later: the row may be deleted, and a trail that reads
 * "ContractTariff 8f3e-…" answers nothing.
 */
export function labelFor(entity, row) {
  if (!row) return null;
  const first = (...keys) => {
    for (const key of keys) {
      const value = row[key];
      if (value != null && String(value).trim() !== '') return String(value).trim();
    }
    return null;
  };

  switch (entity) {
    case 'Trip':
      return first('tpo_number', 'cmr_number', 'trip_number');
    case 'Invoice':
      return [row.series, row.number].filter(Boolean).join(' ') || null;
    case 'Vehicle':
      return first('plate');
    case 'ContractTariff':
      return [first('vehicle_class'), first('valid_from')].filter(Boolean).join(' de la ') || null;
    case 'TripCharge':
      return first('label', 'code', 'kind');
    default:
      return first('name', 'label', 'title', 'code', 'plate', 'number');
  }
}

/** The caller's address, first hop only — the rest of an X-Forwarded-For chain is unverified. */
export function ipFrom(req) {
  const forwarded = req?.headers?.['x-forwarded-for'];
  if (typeof forwarded === 'string' && forwarded.trim()) return forwarded.split(',')[0].trim();
  return req?.ip || req?.socket?.remoteAddress || null;
}

/** Who did it, flattened so the trail survives the user being deleted. */
export function actorFrom(req) {
  const user = req?.user || {};
  return {
    user_id: user.id ?? null,
    user_name: user.full_name || user.name || null,
    user_email: user.email || null,
    user_role: user.role || null,
    ip: ipFrom(req),
  };
}

/**
 * Writes one entry.
 *
 * Takes a `client` so the caller can put it inside the transaction that made the change: an
 * audit trail with silent gaps is worse than none, because a gap is indistinguishable from
 * "nothing happened". Where the caller has no transaction, passing the pool is fine.
 */
export async function recordAudit(client, entry) {
  const {
    company_id, action, entity, entity_id = null, label = null,
    changes = null, detail = null,
    user_id = null, user_name = null, user_email = null, user_role = null, ip = null,
  } = entry;

  if (!company_id || !action || !entity) {
    throw new Error('audit: company_id, action and entity are required');
  }

  await client.query(
    `INSERT INTO audit_events
       (company_id, user_id, user_name, user_email, user_role,
        action, entity, entity_id, label, changes, detail, ip)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
    [company_id, user_id, user_name, user_email, user_role,
      action, entity, entity_id, label,
      changes ? JSON.stringify(changes) : null,
      detail ? JSON.stringify(detail) : null,
      ip]
  );
}

/**
 * Records an entity change, skipping what is not audited and updates that changed nothing.
 *
 * Never throws. The business write has already succeeded by the time this runs, and refusing to
 * save a legitimate tariff because the trail was briefly unavailable would be the worse failure —
 * so the error is logged loudly and the write stands.
 */
export async function auditEntityChange(client, req, { action, entity, before, after }) {
  if (!isAudited(entity)) return null;
  try {
    const row = after || before;
    let changes = null;
    if (action === 'update') {
      changes = diffRows(before, after);
      // An update that changed nothing is not an event.
      if (Object.keys(changes).length === 0) return null;
    } else {
      changes = snapshotRow(action === 'delete' ? before : after);
    }

    await recordAudit(client, {
      company_id: req.user.company_id,
      action,
      entity,
      entity_id: row?.id ?? null,
      label: labelFor(entity, row),
      changes,
      ...actorFrom(req),
    });
    return true;
  } catch (err) {
    console.error('[audit]', entity, action, err.message);
    return false;
  }
}
