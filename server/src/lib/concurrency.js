import path from 'path';
import crypto from 'crypto';

/** Annex fields the office types in Editează — re-extract must not wipe them. */
export const OFFICE_AVIZ_FIELDS = [
  'valoare_tpo',
  'numar_curse',
  'taxe_suplimentare',
  'km_parcursi',
  'tarif_km',
  'observatii',
  'ruta_display',
];

export const OCR_AVIZ_FIELDS = [
  'numar_tpo',
  'data_efectuare_cursa',
  'numar_auto',
  'ruta_transport',
  'tip_marfa',
  'cantitate_marfa',
  'numar_document_marfa',
];

function filledOfficeValue(key, value) {
  if (value == null) return false;
  if (typeof value === 'string') return value.trim() !== '';
  if (key === 'observatii') return true;
  if (Number(value) === 0) return false;
  return true;
}

/** Keep km/taxe/observatii from the stored row when re-extracting from the PDF. */
export function mergeReextractRow(existing, extractedFields) {
  const out = { ...extractedFields };
  if (!existing) return out;
  for (const key of OFFICE_AVIZ_FIELDS) {
    if (filledOfficeValue(key, existing[key])) out[key] = existing[key];
  }
  return out;
}

/** Salvează / re-extract must not demote Confirmat back to Extras. */
export function nextAvizStatusOnSave(current, requested) {
  if (current === 'confirmed') return 'confirmed';
  if (requested) return requested;
  if (current === 'uploaded') return 'extracted';
  return current || 'extracted';
}

export function repairNeedsWrite(existing, repaired) {
  return OCR_AVIZ_FIELDS.some(
    (key) => String(existing?.[key] ?? '') !== String(repaired?.[key] ?? '')
  );
}

export function isPgUniqueViolation(err) {
  return err?.code === '23505';
}

/** Omit status on trip update when the dispatcher did not change the select. */
export function tripStatusForOfficeSave(openedStatus, formStatus) {
  if (formStatus == null || formStatus === '') return undefined;
  if (openedStatus === formStatus) return undefined;
  return formStatus;
}

export function nextWarehouseQty(current, delta) {
  const n = Number(current) || 0;
  const d = Number(delta) || 0;
  return Math.max(0, n + d);
}

const COMPANY_PREFIX_RE = /^c-[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}-/;

export function uniqueUploadFilename(originalname, { now = Date.now(), id, companyId } = {}) {
  const safe = String(originalname || 'file').replace(/[^a-zA-Z0-9._-]/g, '_');
  const ext = path.extname(safe).slice(0, 12);
  const base = path.basename(safe, path.extname(safe)).slice(0, 40) || 'file';
  const rand = id || crypto.randomUUID();
  const rest = `${now}-${rand}-${base}${ext}`;
  const cid = String(companyId || '').trim();
  if (/^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(cid)) {
    return `c-${cid}-${rest}`;
  }
  return rest;
}

export function safeUploadBasename(filename) {
  const name = path.basename(String(filename || ''));
  if (!name || name === '.' || name === '..' || name.includes('..')) return null;
  return name;
}

export function filenameHasCompanyPrefix(filename) {
  const name = safeUploadBasename(filename) || '';
  return COMPANY_PREFIX_RE.test(name);
}

export function filenameOwnedByCompany(filename, companyId) {
  const name = safeUploadBasename(filename);
  const cid = String(companyId || '').trim();
  if (!name || !cid) return false;
  return name.startsWith(`c-${cid}-`);
}

/** Tenant-scoped read: prefixed files must match company; legacy files need a DB row. */
export async function canReadUpload(queryFn, companyId, filename) {
  const name = safeUploadBasename(filename);
  if (!name || !companyId) return false;
  if (filenameOwnedByCompany(name, companyId)) return true;
  if (filenameHasCompanyPrefix(name)) return false;
  const needle = `%${name}`;
  const result = await queryFn(
    `SELECT 1 FROM aviz_documents WHERE company_id = $1 AND file_url LIKE $2
     UNION ALL
     SELECT 1 FROM trip_documents WHERE company_id = $1 AND (original_image_url LIKE $2 OR final_pdf_url LIKE $2)
     UNION ALL
     SELECT 1 FROM client_confirmations WHERE company_id = $1 AND damage_image_url LIKE $2
     UNION ALL
     SELECT 1 FROM companies WHERE id = $1 AND logo_url LIKE $2
     LIMIT 1`,
    [companyId, needle]
  );
  return Boolean(result.rows?.[0]);
}

/** Driver-accessible entity actions. Everything else is office-only. */
export const DRIVER_ENTITY_ACTIONS = {
  Driver: new Set(['list', 'get', 'filter']),
  Trip: new Set(['list', 'get', 'filter', 'update']),
  TripDocument: new Set(['list', 'get', 'filter', 'create', 'update']),
  ChatMessage: new Set(['list', 'get', 'filter', 'create', 'update']),
  DriverNotification: new Set(['list', 'get', 'filter', 'update']),
};

export const DRIVER_TRIP_WRITABLE = [
  'status',
  'start_mileage',
  'end_mileage',
  'actual_fuel_consumption',
  'actual_delivery_date',
];

export function entityActionFromRequest(method, pathSuffix) {
  const p = pathSuffix || '';
  if (p.includes('/filter')) return 'filter';
  if (p.includes('/bulk') && method === 'POST') return 'create';
  if (p.includes('/bulk') && method === 'PUT') return 'update';
  if (p.includes('/adjust')) return 'update';
  if (method === 'GET' && /\/[a-zA-Z0-9-]+$/.test(p) && !p.endsWith('/filter')) {
    return p.split('/').filter(Boolean).length >= 2 ? 'get' : 'list';
  }
  if (method === 'GET') return 'list';
  if (method === 'POST') return 'create';
  if (method === 'PUT') return 'update';
  if (method === 'DELETE') return 'delete';
  return method.toLowerCase();
}

export function entityAllowedForRole(role, entity, action) {
  if (role !== 'driver') return true;
  const allowed = DRIVER_ENTITY_ACTIONS[entity];
  if (!allowed) return false;
  return allowed.has(action);
}

export function applyBearerFromQuery(headerAuth, queryToken) {
  if (headerAuth) return headerAuth;
  if (!queryToken) return null;
  return `Bearer ${queryToken}`;
}
