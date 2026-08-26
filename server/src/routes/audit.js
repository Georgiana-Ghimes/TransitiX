/**
 * Reading the trail.
 *
 * Two doors, on purpose. The history of one record — "what happened to this trip" — is ordinary
 * operational context, so any office user can open it. The searchable log across everybody is a
 * different thing: it answers "what has this person been doing", and that is an owner's question,
 * so it is admin-only.
 */
import { Router } from 'express';
import { query } from '../db.js';
import { authRequired, officeRequired, adminRequired } from '../middleware/auth.js';
import { AUDITED_ENTITIES, NOT_AUDITED } from '../lib/audit/events.js';

const router = Router();
router.use(authRequired, officeRequired);

const MAX_LIMIT = 200;

function fail(res, err, fallback) {
  const status = err?.status || 500;
  if (status >= 500) console.error('[audit]', err);
  res.status(status).json({ message: err?.message || fallback });
}

function serializeEvent(row) {
  return {
    id: row.id,
    created_at: row.created_at,
    action: row.action,
    entity: row.entity,
    entity_id: row.entity_id,
    label: row.label,
    changes: row.changes,
    detail: row.detail,
    ip: row.ip,
    user: {
      id: row.user_id,
      name: row.user_name,
      email: row.user_email,
      role: row.user_role,
    },
  };
}

/**
 * The searchable log.
 *
 * Every filter is optional and every one is a bound parameter — the entity name arrives from the
 * client and is compared, never interpolated.
 */
router.get('/', adminRequired, async (req, res) => {
  try {
    const where = ['company_id = $1'];
    const params = [req.user.company_id];
    const add = (clause, value) => {
      params.push(value);
      where.push(clause.replace('$?', `$${params.length}`));
    };

    if (req.query.entity) add('entity = $?', String(req.query.entity));
    if (req.query.entity_id) add('entity_id = $?::uuid', String(req.query.entity_id));
    if (req.query.action) add('action = $?', String(req.query.action));
    if (req.query.user_id) add('user_id = $?::uuid', String(req.query.user_id));
    if (req.query.from) add('created_at >= $?::date', String(req.query.from));
    // The end of the range is inclusive: a person filtering "to 31 March" means that day too.
    if (req.query.to) add("created_at < ($?::date + INTERVAL '1 day')", String(req.query.to));
    if (req.query.q) {
      // One value, three columns — built directly rather than through `add`, which fills a
      // single placeholder.
      params.push(`%${req.query.q}%`);
      const idx = `$${params.length}`;
      where.push(`(label ILIKE ${idx} OR user_name ILIKE ${idx} OR user_email ILIKE ${idx})`);
    }

    const limit = Math.min(Number(req.query.limit) || 50, MAX_LIMIT);
    const offset = Math.max(Number(req.query.offset) || 0, 0);

    const rows = await query(
      `SELECT * FROM audit_events
       WHERE ${where.join(' AND ')}
       ORDER BY created_at DESC, id DESC
       LIMIT ${limit} OFFSET ${offset}`,
      params
    );
    const total = await query(
      `SELECT COUNT(*)::int AS c FROM audit_events WHERE ${where.join(' AND ')}`,
      params
    );

    res.json({
      events: rows.rows.map(serializeEvent),
      total: total.rows[0].c,
      limit,
      offset,
    });
  } catch (err) {
    fail(res, err, 'Jurnalul nu a putut fi citit.');
  }
});

/**
 * Everything that happened to one record, oldest last.
 *
 * Office-wide rather than admin-only: knowing why a trip looks the way it does is part of doing
 * the work, not an audit of a colleague.
 */
router.get('/trail/:entity/:id', async (req, res) => {
  try {
    const rows = await query(
      `SELECT * FROM audit_events
       WHERE company_id = $1 AND entity = $2 AND entity_id = $3::uuid
       ORDER BY created_at DESC, id DESC
       LIMIT $4`,
      [req.user.company_id, req.params.entity, req.params.id, MAX_LIMIT]
    );
    res.json({ events: rows.rows.map(serializeEvent) });
  } catch (err) {
    fail(res, err, 'Istoricul nu a putut fi citit.');
  }
});

/**
 * What the filters can offer, and what the trail deliberately does not cover.
 *
 * `NOT_AUDITED` is returned alongside on purpose: somebody looking for a GPS ping in here should
 * find out why it is missing rather than conclude the log is broken.
 */
router.get('/meta', adminRequired, async (req, res) => {
  try {
    const users = await query(
      `SELECT DISTINCT user_id, user_name, user_email
       FROM audit_events
       WHERE company_id = $1 AND user_id IS NOT NULL
       ORDER BY user_email NULLS LAST`,
      [req.user.company_id]
    );
    const entities = await query(
      `SELECT entity, COUNT(*)::int AS c FROM audit_events
       WHERE company_id = $1 GROUP BY entity ORDER BY c DESC`,
      [req.user.company_id]
    );
    res.json({
      audited: AUDITED_ENTITIES,
      not_audited: NOT_AUDITED,
      present: entities.rows,
      users: users.rows.map((u) => ({ id: u.user_id, name: u.user_name, email: u.user_email })),
    });
  } catch (err) {
    fail(res, err, 'Filtrele nu au putut fi încărcate.');
  }
});

export default router;
