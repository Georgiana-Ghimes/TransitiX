import { Router } from 'express';
import { authRequired, officeRequired } from '../middleware/auth.js';
import { query, withTransaction } from '../db.js';
import { serializeRow } from '../entities.js';
import { balanceReport, buildTerritoryDrafts } from '../lib/geo/territories.js';
import { createLogger } from '../lib/log.js';

const log = createLogger({ scope: 'territories' });

const router = Router();
router.use(authRequired, officeRequired);

function sendError(res, err, fallback) {
  const status = err.status || 500;
  if (status >= 500) log.error('eroare', err);
  res.status(status).json({ message: err.message || fallback });
}

async function loadLocationsForCluster(companyId) {
  // Aggregate recent order demand onto each location so clustering balances real load.
  const result = await query(
    `SELECT l.id, l.name, l.latitude, l.longitude, l.territory_id, l.kind,
            COALESCE(agg.weight_kg, 0) AS weight_kg,
            COALESCE(agg.volume_mc, 0) AS volume_mc,
            COALESCE(agg.stop_count, 0) AS stop_count
     FROM locations l
     LEFT JOIN (
       SELECT location_id,
              SUM(weight_kg)::float AS weight_kg,
              SUM(volume_mc)::float AS volume_mc,
              COUNT(*)::int AS stop_count
       FROM orders
       WHERE company_id = $1
         AND status NOT IN ('anulat', 'livrat', 'esuat')
         AND location_id IS NOT NULL
       GROUP BY location_id
     ) agg ON agg.location_id = l.id
     WHERE l.company_id = $1
       AND l.is_active = TRUE
       AND l.latitude IS NOT NULL
       AND l.longitude IS NOT NULL`,
    [companyId]
  );
  return result.rows;
}

async function territoriesWithStats(companyId) {
  const result = await query(
    `SELECT t.*,
            (SELECT COUNT(*)::int FROM locations l
              WHERE l.company_id = t.company_id AND l.territory_id = t.id AND l.is_active = TRUE
            ) AS location_count
     FROM territories t
     WHERE t.company_id = $1 AND t.is_active = TRUE
     ORDER BY t.sort_order, t.name`,
    [companyId]
  );
  return result.rows.map(serializeRow);
}

router.get('/', async (req, res) => {
  try {
    const rows = await territoriesWithStats(req.user.company_id);
    res.json(rows);
  } catch (err) {
    sendError(res, err, 'Citirea teritoriilor a eșuat');
  }
});

router.get('/balance', async (req, res) => {
  try {
    const locations = await loadLocationsForCluster(req.user.company_id);
    const territories = await territoriesWithStats(req.user.company_id);
    const clusters = territories.map((t) => {
      const members = locations.filter((l) => l.territory_id === t.id);
      const weight = members.reduce((s, m) => {
        const vol = Number(m.volume_mc) || 0;
        const kg = Number(m.weight_kg) || 0;
        const stops = Number(m.stop_count) || 0;
        return s + (vol * 10 + kg / 100 + stops || 1);
      }, 0);
      return {
        index: t.sort_order,
        name: t.name,
        color: t.color,
        stop_count: members.length,
        weight: weight || members.length,
        weight_kg: members.reduce((s, m) => s + (Number(m.weight_kg) || 0), 0),
        volume_mc: members.reduce((s, m) => s + (Number(m.volume_mc) || 0), 0),
      };
    });
    res.json({ territories, balance: balanceReport(clusters) });
  } catch (err) {
    sendError(res, err, 'Bilanțul teritoriilor a eșuat');
  }
});

/**
 * Generate k territories from geocoded locations.
 * Body: { k?: number, apply?: boolean }
 * apply=false → preview only; apply=true → replace active territories and reassign.
 */
router.post('/generate', async (req, res) => {
  try {
    const k = Math.min(20, Math.max(2, Number(req.body?.k) || 5));
    const apply = req.body?.apply !== false;
    const locations = await loadLocationsForCluster(req.user.company_id);
    if (locations.length < k) {
      return res.status(422).json({
        message: `Ai nevoie de cel puțin ${k} locații geocodate (acum ${locations.length})`,
      });
    }

    const { drafts, balance } = buildTerritoryDrafts(locations, { k });

    if (!apply) {
      return res.json({ preview: true, drafts, balance });
    }

    const created = await withTransaction(async (client) => {
      await client.query(
        `UPDATE territories SET is_active = FALSE, updated_at = NOW()
         WHERE company_id = $1 AND is_active = TRUE`,
        [req.user.company_id]
      );
      await client.query(
        `UPDATE locations SET territory_id = NULL, updated_at = NOW()
         WHERE company_id = $1`,
        [req.user.company_id]
      );

      const rows = [];
      for (const draft of drafts) {
        const inserted = await client.query(
          `INSERT INTO territories (company_id, name, color, polygon, sort_order, is_active)
           VALUES ($1, $2, $3, $4::jsonb, $5, TRUE)
           RETURNING *`,
          [
            req.user.company_id,
            draft.name,
            draft.color,
            JSON.stringify(draft.polygon),
            draft.sort_order,
          ]
        );
        const terr = inserted.rows[0];
        if (draft.location_ids.length) {
          await client.query(
            `UPDATE locations SET territory_id = $1, updated_at = NOW()
             WHERE company_id = $2 AND id = ANY($3::uuid[])`,
            [terr.id, req.user.company_id, draft.location_ids]
          );
        }
        rows.push({
          ...serializeRow(terr),
          location_ids: draft.location_ids,
          location_count: draft.location_ids.length,
        });
      }
      return rows;
    });

    res.status(201).json({ preview: false, territories: created, balance });
  } catch (err) {
    sendError(res, err, 'Generarea teritoriilor a eșuat');
  }
});

router.patch('/:id', async (req, res) => {
  try {
    const { name, color, polygon, sort_order, is_active } = req.body || {};
    const result = await query(
      `UPDATE territories SET
         name = COALESCE($1, name),
         color = COALESCE($2, color),
         polygon = COALESCE($3::jsonb, polygon),
         sort_order = COALESCE($4, sort_order),
         is_active = COALESCE($5, is_active),
         updated_at = NOW()
       WHERE id = $6 AND company_id = $7
       RETURNING *`,
      [
        name ?? null,
        color ?? null,
        polygon != null ? JSON.stringify(polygon) : null,
        sort_order ?? null,
        is_active ?? null,
        req.params.id,
        req.user.company_id,
      ]
    );
    if (!result.rows[0]) return res.status(404).json({ message: 'Teritoriu inexistent' });
    res.json(serializeRow(result.rows[0]));
  } catch (err) {
    sendError(res, err, 'Actualizarea teritoriului a eșuat');
  }
});

/** Assign locations to a territory (or clear with territory_id null via body.clear). */
router.post('/:id/assign', async (req, res) => {
  try {
    const ids = Array.isArray(req.body?.location_ids) ? req.body.location_ids : [];
    if (!ids.length) return res.status(400).json({ message: 'location_ids este obligatoriu' });

    const terr = await query(
      `SELECT id FROM territories WHERE id = $1 AND company_id = $2 AND is_active = TRUE`,
      [req.params.id, req.user.company_id]
    );
    if (!terr.rows[0]) return res.status(404).json({ message: 'Teritoriu inexistent' });

    await query(
      `UPDATE locations SET territory_id = $1, updated_at = NOW()
       WHERE company_id = $2 AND id = ANY($3::uuid[])`,
      [req.params.id, req.user.company_id, ids]
    );
    res.json({ ok: true, territory_id: req.params.id, assigned: ids.length });
  } catch (err) {
    sendError(res, err, 'Atribuirea a eșuat');
  }
});

router.post('/clear-assignments', async (req, res) => {
  try {
    const result = await query(
      `UPDATE locations SET territory_id = NULL, updated_at = NOW()
       WHERE company_id = $1 AND territory_id IS NOT NULL
       RETURNING id`,
      [req.user.company_id]
    );
    res.json({ ok: true, cleared: result.rowCount });
  } catch (err) {
    sendError(res, err, 'Ștergerea atribuirilor a eșuat');
  }
});

export default router;
