/**
 * Housekeeping, visible and manual.
 *
 * The retention policies run on a timer, which means that without this route nobody can see what
 * they are about to remove or when they last ran. A silent scheduled DELETE is the kind of thing
 * people discover only after the rows are gone.
 *
 * Admin-only, and deliberately not scoped per company: retention is an operator concern about
 * table size, not a tenant feature.
 */
import { Router } from 'express';
import { authRequired, officeRequired, adminRequired } from '../middleware/auth.js';
import {
  NEVER_PRUNED,
  POLICIES,
  DEFAULT_BATCH,
  policyDays,
  previewRetention,
  runRetention,
} from '../lib/maintenance/retention.js';
import { createLogger } from '../lib/log.js';

const log = createLogger({ scope: 'maintenance' });

const router = Router();
router.use(authRequired, officeRequired, adminRequired);

function fail(res, err, fallback) {
  const status = err?.status || 500;
  if (status >= 500) log.error('eroare', err);
  res.status(status).json({ message: err?.message || fallback });
}

/**
 * What the policies are and how many rows each would remove right now.
 *
 * `NEVER_PRUNED` is returned alongside on purpose: the useful thing to see on this screen is not
 * only what gets deleted but what is guaranteed not to.
 */
router.get('/retention', async (_req, res) => {
  try {
    res.json({
      policies: await previewRetention(),
      never_pruned: NEVER_PRUNED,
      batch: DEFAULT_BATCH,
    });
  } catch (err) {
    fail(res, err, 'Nu am putut calcula ce ar fi de curățat.');
  }
});

/**
 * Runs one pass now.
 *
 * `more: true` in the response means the backlog was larger than a single batch — the answer is
 * to call again, not to raise the batch until a delete locks the table for minutes.
 */
router.post('/retention/run', async (req, res) => {
  try {
    const requested = Number(req.body?.batch);
    const batch = Number.isFinite(requested) && requested > 0
      ? Math.min(Math.floor(requested), 50_000)
      : DEFAULT_BATCH;
    const result = await runRetention({ batch });
    res.status(result.skipped ? 409 : 200).json(result);
  } catch (err) {
    fail(res, err, 'Curățenia nu a putut rula.');
  }
});

/** The configured policy, without touching the database — useful when something looks wrong. */
router.get('/retention/policies', (_req, res) => {
  res.json({
    policies: POLICIES.map((p) => ({
      id: p.id,
      table: p.table,
      label: p.label,
      reason: p.reason,
      default_days: p.days,
      days: policyDays(p),
      env: `RETAIN_${p.id.toUpperCase()}_DAYS`,
    })),
    never_pruned: NEVER_PRUNED,
  });
});

export default router;
