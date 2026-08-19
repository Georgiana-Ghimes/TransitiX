/** Compact UIT (ANAF codes are typically 16 alphanumerics; allow 8–36). */
export function normalizeUitCode(raw) {
  const compact = String(raw || '').trim().toUpperCase().replace(/[\s-]/g, '');
  if (!compact) return { value: null };
  if (!/^[A-Z0-9]{8,36}$/.test(compact)) {
    return { error: 'Cod UIT invalid (8–36 caractere alfanumerice)' };
  }
  return { value: compact };
}

export function tripMargin(revenue, cost) {
  if (revenue == null || revenue === '' || cost == null || cost === '') return null;
  const r = Number(revenue);
  const c = Number(cost);
  if (!Number.isFinite(r) || !Number.isFinite(c)) return null;
  return Math.round((r - c) * 100) / 100;
}
