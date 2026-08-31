import { Router } from 'express';
import { query } from '../db.js';
import { rateLimit } from '../lib/rateLimit.js';

const router = Router();

const attemptLimit = rateLimit({ windowMs: 15 * 60 * 1000, max: 20 });
const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/**
 * Public lead capture — does not create a company or user.
 * Platform GOD reviews rows under /platform and provisions manually.
 */
router.post('/request-access', attemptLimit, async (req, res) => {
  try {
    const body = req.body || {};
    const company_name = String(body.company_name || '').trim();
    const contact_name = String(body.contact_name || '').trim();
    const email = String(body.email || '').trim().toLowerCase();
    const phone = String(body.phone || '').trim() || null;
    const message = String(body.message || '').trim() || null;
    const preferred_profile = body.preferred_profile === 'documents' ? 'documents' : 'full';

    const errors = [];
    if (company_name.length < 2) errors.push('Numele firmei este obligatoriu.');
    if (contact_name.length < 2) errors.push('Numele de contact este obligatoriu.');
    if (!EMAIL_SHAPE.test(email)) errors.push('Adresa de email nu pare validă.');
    if (errors.length) {
      return res.status(400).json({ message: errors.join(' ') });
    }

    const inserted = await query(
      `INSERT INTO access_leads
         (company_name, contact_name, email, phone, message, preferred_profile)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id, created_at`,
      [company_name, contact_name, email, phone, message, preferred_profile],
    );

    res.status(201).json({
      ok: true,
      id: inserted.rows[0].id,
      message: 'Mulțumim. Te contactăm pentru setup.',
    });
  } catch (err) {
    console.error('[public/request-access]', err);
    res.status(500).json({ message: 'Cererea nu a putut fi înregistrată. Încearcă din nou.' });
  }
});

export default router;
