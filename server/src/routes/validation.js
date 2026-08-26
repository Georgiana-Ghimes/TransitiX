/**
 * Data-quality findings: what in the current data would produce a wrong invoice or an
 * uncheckable report.
 *
 * Dismissals reuse `office_notification_dismissals`, the same table the notification bell uses,
 * so a finding put aside on this screen does not come back through the bell an hour later.
 */
import { Router } from 'express';
import { authRequired, officeRequired } from '../middleware/auth.js';
import { collectFindings, DEFAULT_WINDOW_DAYS } from '../lib/validation/checks.js';
import { summariseFindings } from '../lib/validation/rules.js';
import { RULES } from '../lib/validation/catalog.js';
import { getDismissalState, markNotificationRead } from '../lib/officeNotifications.js';

const router = Router();
router.use(authRequired, officeRequired);

/** What each rule looks for — so the screen can explain itself without hard-coded copy. */
router.get('/rules', (_req, res) => {
  res.json({ rules: RULES });
});

router.get('/findings', async (req, res) => {
  try {
    const windowDays = Number(req.query.window_days) || DEFAULT_WINDOW_DAYS;
    const [result, dismissals] = await Promise.all([
      collectFindings(req.user.company_id, { windowDays }),
      getDismissalState(req.user.company_id),
    ]);

    const includeDismissed = req.query.include_dismissed === 'true';
    const all = result.findings.map((item) => ({
      ...item,
      dismissed: Boolean(dismissals.get(item.key)?.is_read),
    }));
    const findings = all.filter((item) => includeDismissed || !item.dismissed);

    res.json({
      ...result,
      findings,
      // The summary counts what is on screen. A header reading "2 errors" above a list showing
      // one is the screen contradicting itself, and the operator has no way to tell which is right.
      summary: summariseFindings(findings),
      dismissed_count: all.filter((item) => item.dismissed).length,
    });
  } catch (err) {
    console.error('[validation]', err);
    res.status(500).json({ message: err.message || 'Verificările au eșuat' });
  }
});

/** Puts one finding aside. It returns if the underlying data changes, because the key changes. */
router.post('/findings/dismiss', async (req, res) => {
  try {
    const key = String(req.body?.key || '').trim();
    if (!key) return res.status(400).json({ message: 'Lipsește cheia constatării' });
    await markNotificationRead(req.user.company_id, key);
    res.json({ ok: true, key });
  } catch (err) {
    console.error('[validation]', err);
    res.status(500).json({ message: err.message || 'Constatarea nu a putut fi ascunsă' });
  }
});

export default router;
