import { query } from '../db.js';
import { serializeRow } from '../entities.js';

const COMPANY_WRITABLE = [
  'name', 'cui', 'vat_regime', 'address', 'phone', 'email', 'website',
  'logo_url', 'default_currency', 'fiscal_code', 'bank_account', 'settings',
];

const DEFAULT_SETTINGS = {
  document_expiry_days: [30, 15, 7, 1],
};

export function publicCompany(row) {
  if (!row) return null;
  const out = serializeRow(row);
  const settings = out.settings && typeof out.settings === 'object' && !Array.isArray(out.settings)
    ? out.settings
    : {};
  out.settings = {
    ...DEFAULT_SETTINGS,
    ...settings,
    document_expiry_days: Array.isArray(settings.document_expiry_days)
      ? settings.document_expiry_days
      : DEFAULT_SETTINGS.document_expiry_days,
  };
  return out;
}

export function pickCompanyWritable(body) {
  const out = {};
  for (const key of COMPANY_WRITABLE) {
    if (body?.[key] === undefined) continue;
    if (key === 'settings' && body.settings && typeof body.settings === 'object') {
      out.settings = JSON.stringify({
        ...DEFAULT_SETTINGS,
        ...body.settings,
      });
    } else {
      out[key] = body[key] === '' ? null : body[key];
    }
  }
  return out;
}

export async function getCompanyById(companyId) {
  const result = await query(`SELECT * FROM companies WHERE id = $1`, [companyId]);
  return publicCompany(result.rows[0]);
}
