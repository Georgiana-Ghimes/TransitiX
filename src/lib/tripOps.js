export function tripMargin(revenue, cost) {
  if (revenue == null || revenue === '' || cost == null || cost === '') return null;
  const r = Number(revenue);
  const c = Number(cost);
  if (!Number.isFinite(r) || !Number.isFinite(c)) return null;
  return Math.round((r - c) * 100) / 100;
}

export function formatRon(value) {
  if (value == null || value === '') return '—';
  const n = Number(value);
  if (!Number.isFinite(n)) return '—';
  return `${n.toLocaleString('ro-RO', { minimumFractionDigits: 0, maximumFractionDigits: 2 })} RON`;
}
