/**
 * The consignment note for a trip — written, not photographed.
 *
 * Office and driver share these endpoints. A driver may only touch a trip assigned to them; the
 * office may see and correct any of them, which is what happens when a note comes back with a
 * box a dispatcher has to fix before invoicing.
 */
import { Router } from 'express';
import { query, withTransaction } from '../db.js';
import { authRequired } from '../middleware/auth.js';
import { serializeRow } from '../entities.js';
import { saveProofDataUrl } from '../lib/telematics/epod.js';

import {
  CMR_BOXES,
  SIGNATURES,
  STAGES,
  cmrCompleteness,
  conflictsWithScan,
  mergeCmr,
  prefillFromTrip,
  sanitiseCmr,
  validateCmr,
} from '../lib/cmr/form.js';

const router = Router();
router.use(authRequired);

function fail(res, err, fallback) {
  const status = err?.status || 500;
  if (status >= 500) console.error('[cmr]', err);
  res.status(status).json({ message: err?.message || fallback });
}

function httpError(message, status) {
  const err = new Error(message);
  err.status = status;
  return err;
}

/**
 * The trip, and the right to touch it.
 *
 * A driver reaching a trip that is not theirs gets the same 404 as one that does not exist —
 * a 403 would confirm the trip exists, which is not theirs to learn.
 */
async function loadTrip(user, tripId) {
  const found = await query(
    `SELECT t.*, d.user_id AS driver_user_id
     FROM trips t
     LEFT JOIN drivers d ON d.id = t.driver_id
     WHERE t.id = $1 AND t.company_id = $2`,
    [tripId, user.company_id]
  );
  const trip = found.rows[0];
  if (!trip) throw httpError('Cursă inexistentă', 404);
  if (user.role === 'driver' && trip.driver_user_id !== user.id) throw httpError('Cursă inexistentă', 404);
  return trip;
}

/**
 * The carrier, for box 16, plus a place for box 21.
 *
 * `companies` has no city of its own, so "drawn up at" comes from the default depot — the place
 * the company actually dispatches from. With no depot set the box stays blank for the driver to
 * fill; a guessed town on a consignment note is worse than an empty line.
 */
async function loadCompany(companyId) {
  const found = await query(
    `SELECT c.name, c.address, c.cui, l.city
     FROM companies c
     LEFT JOIN locations l ON l.id = c.default_depot_location_id
     WHERE c.id = $1`,
    [companyId]
  );
  return found.rows[0] ?? {};
}

async function loadDocument(companyId, tripId) {
  const found = await query(
    'SELECT * FROM trip_documents WHERE company_id = $1 AND trip_id = $2 ORDER BY created_at ASC LIMIT 1',
    [companyId, tripId]
  );
  return found.rows[0] ?? null;
}

function describe(trip, company, document) {
  const data = mergeCmr(prefillFromTrip(trip, company), document?.cmr_data ?? null);
  const signatures = document?.signatures ?? {};
  return {
    trip: { id: trip.id, cmr_number: trip.cmr_number, status: trip.status },
    document: document ? serializeRow(document) : null,
    source: document?.source ?? null,
    boxes: CMR_BOXES,
    signature_boxes: SIGNATURES,
    data,
    signatures,
    completeness: cmrCompleteness(data),
    stages: Object.fromEntries(STAGES.map((stage) => [
      stage,
      {
        ...validateCmr(data, { stage, signatures }),
        signed_at: stage === 'incarcare' ? document?.signed_loading_at ?? null : document?.signed_delivery_at ?? null,
      },
    ])),
    // A trip that already carries a scan does not need a written note; offering both is how a
    // photograph and a typed note end up disagreeing about what was loaded.
    has_scan: conflictsWithScan(document),
  };
}

/** The note as it stands: prefill from the trip, with whatever has been written over it. */
router.get('/trips/:tripId', async (req, res) => {
  try {
    const trip = await loadTrip(req.user, req.params.tripId);
    const [company, document] = await Promise.all([
      loadCompany(req.user.company_id),
      loadDocument(req.user.company_id, trip.id),
    ]);
    res.json(describe(trip, company, document));
  } catch (err) {
    fail(res, err, 'CMR-ul nu a putut fi citit');
  }
});

/** Saves a draft. Never signs — signing is a separate, deliberate act. */
router.put('/trips/:tripId', async (req, res) => {
  try {
    const trip = await loadTrip(req.user, req.params.tripId);
    const patch = sanitiseCmr(req.body?.data ?? {});
    const company = await loadCompany(req.user.company_id);

    const saved = await withTransaction(async (client) => {
      const existing = (await client.query(
        'SELECT * FROM trip_documents WHERE company_id = $1 AND trip_id = $2 ORDER BY created_at ASC LIMIT 1',
        [req.user.company_id, trip.id]
      )).rows[0];

      if (conflictsWithScan(existing)) {
        throw httpError('Cursa are deja un CMR scanat — formularul digital e dezactivat', 409);
      }
      if (existing?.signed_delivery_at) {
        throw httpError('CMR-ul a fost semnat la livrare și nu mai poate fi modificat', 409);
      }

      const merged = { ...(existing?.cmr_data ?? {}), ...patch };
      if (existing) {
        return (await client.query(
          `UPDATE trip_documents
           SET cmr_data = $1::jsonb, source = 'digital', updated_at = NOW()
           WHERE id = $2 AND company_id = $3 RETURNING *`,
          [JSON.stringify(merged), existing.id, req.user.company_id]
        )).rows[0];
      }
      return (await client.query(
        `INSERT INTO trip_documents (company_id, trip_id, cmr_number, source, cmr_data, created_by)
         VALUES ($1, $2, $3, 'digital', $4::jsonb, $5) RETURNING *`,
        [req.user.company_id, trip.id, trip.cmr_number, JSON.stringify(merged), req.user.id]
      )).rows[0];
    });

    res.json(describe(trip, company, saved));
  } catch (err) {
    fail(res, err, 'Salvarea CMR-ului a eșuat');
  }
});

/**
 * Signs one stage.
 *
 * The check runs over the merged document, not over the payload, so a note cannot be signed by
 * sending only the signature and leaving the weight box empty on the server.
 */
router.post('/trips/:tripId/sign', async (req, res) => {
  try {
    const trip = await loadTrip(req.user, req.params.tripId);
    const stage = String(req.body?.stage || '');
    if (!STAGES.includes(stage)) return res.status(400).json({ message: 'Etapă necunoscută' });

    const company = await loadCompany(req.user.company_id);
    const patch = sanitiseCmr(req.body?.data ?? {});

    const saved = await withTransaction(async (client) => {
      const existing = (await client.query(
        'SELECT * FROM trip_documents WHERE company_id = $1 AND trip_id = $2 ORDER BY created_at ASC LIMIT 1',
        [req.user.company_id, trip.id]
      )).rows[0];

      if (conflictsWithScan(existing)) {
        throw httpError('Cursa are deja un CMR scanat — formularul digital e dezactivat', 409);
      }
      if (stage === 'livrare' && !existing?.signed_loading_at) {
        throw httpError('Semnează mai întâi etapa de încărcare', 409);
      }

      const data = mergeCmr(prefillFromTrip(trip, company), { ...(existing?.cmr_data ?? {}), ...patch });
      const signatures = { ...(existing?.signatures ?? {}) };

      for (const sig of SIGNATURES) {
        if (sig.stage !== stage) continue;
        const incoming = req.body?.signatures?.[sig.id];
        if (!incoming) continue;
        if (signatures[sig.id]) continue; // a signature already given is not re-drawn
        const stored = saveProofDataUrl(req.user.company_id, incoming, { kind: sig.id });
        if (!stored.ok) throw httpError(`${sig.label}: ${stored.error}`, 400);
        signatures[sig.id] = stored.url;
      }

      const check = validateCmr(data, { stage, signatures });
      if (!check.ok) {
        const err = httpError('CMR incomplet pentru această etapă', 422);
        err.missing = check.missing;
        throw err;
      }

      const merged = { ...(existing?.cmr_data ?? {}), ...patch };
      const signedColumn = stage === 'incarcare' ? 'signed_loading_at' : 'signed_delivery_at';
      let savedDoc;
      if (existing) {
        savedDoc = (await client.query(
          `UPDATE trip_documents
           SET cmr_data = $1::jsonb, signatures = $2::jsonb, source = 'digital',
               ${signedColumn} = COALESCE(${signedColumn}, NOW()),
               is_confirmed = CASE WHEN $3 = 'livrare' THEN TRUE ELSE is_confirmed END,
               updated_at = NOW()
           WHERE id = $4 AND company_id = $5 RETURNING *`,
          [JSON.stringify(merged), JSON.stringify(signatures), stage, existing.id, req.user.company_id]
        )).rows[0];
      } else {
        savedDoc = (await client.query(
          `INSERT INTO trip_documents (company_id, trip_id, cmr_number, source, cmr_data,
             signatures, ${signedColumn}, created_by)
           VALUES ($1, $2, $3, 'digital', $4::jsonb, $5::jsonb, NOW(), $6) RETURNING *`,
          [req.user.company_id, trip.id, trip.cmr_number, JSON.stringify(merged),
           JSON.stringify(signatures), req.user.id]
        )).rows[0];
      }

      // What the driver weighed at the ramp is the figure reports and TPO need on the trip.
      if (stage === 'incarcare') {
        await client.query(
          `UPDATE trips SET
             gross_weight_kg = COALESCE($1::numeric, gross_weight_kg),
             weight_kg = COALESCE($1::numeric, weight_kg),
             package_count = COALESCE($2::int, package_count),
             goods_description = COALESCE(NULLIF(TRIM($3::text), ''), goods_description),
             updated_at = NOW()
           WHERE id = $4 AND company_id = $5`,
          [
            data.greutate_bruta_kg ?? null,
            data.numar_colete ?? null,
            data.natura_marfii == null ? '' : String(data.natura_marfii),
            trip.id,
            req.user.company_id,
          ]
        );
      }

      return savedDoc;
    });

    const freshTrip = await loadTrip(req.user, req.params.tripId);
    res.json(describe(freshTrip, company, saved));
  } catch (err) {
    if (err?.missing) {
      return res.status(422).json({ message: err.message, missing: err.missing });
    }
    fail(res, err, 'Semnarea CMR-ului a eșuat');
  }
});

export default router;
