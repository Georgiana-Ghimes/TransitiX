/**
 * Display helpers for the planning / scenario screen.
 */

const STATUS_LABELS = {
  draft: 'În lucru',
  rulat: 'Rulat',
  esuat: 'Eșuat',
  promovat: 'În plan',
};

export function scenarioStatusLabel(status) {
  return STATUS_LABELS[status] || status || '—';
}

export function formatKm(value) {
  if (value == null || value === '') return '—';
  const n = Number(value);
  if (!Number.isFinite(n)) return '—';
  return `${n.toLocaleString('ro-RO', { maximumFractionDigits: 1 })} km`;
}

export function formatHours(minutes) {
  if (minutes == null || minutes === '') return '—';
  const n = Number(minutes);
  if (!Number.isFinite(n)) return '—';
  if (n < 60) return `${Math.round(n)} min`;
  const h = Math.floor(n / 60);
  const m = Math.round(n % 60);
  return m ? `${h} h ${m} min` : `${h} h`;
}

export function formatLei(value) {
  if (value == null || value === '') return '—';
  const n = Number(value);
  if (!Number.isFinite(n)) return '—';
  return `${n.toLocaleString('ro-RO', { minimumFractionDigits: 0, maximumFractionDigits: 2 })} lei`;
}

export function todayIso() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** Capabilities typed as a comma-separated string ↔ TEXT[] for the API. */
export function parseCapabilities(text) {
  return String(text || '')
    .split(/[,;]/)
    .map((s) => s.trim())
    .filter(Boolean);
}

export function formatCapabilities(list) {
  if (!Array.isArray(list) || !list.length) return '';
  return list.join(', ');
}

/** Compare two scenarios on the KPI columns the dispatcher cares about. */
export function compareScenarioKpis(scenarios = []) {
  return scenarios.map((s) => ({
    id: s.id,
    name: s.name,
    status: s.status,
    is_committed: s.is_committed,
    routes: s.kpis?.routes ?? null,
    distance_km: s.kpis?.distance_km ?? null,
    duration_min: s.kpis?.duration_min ?? null,
    cost: s.kpis?.cost ?? null,
    unassigned: s.kpis?.unassigned ?? null,
    breaks_inserted: s.kpis?.breaks_inserted ?? null,
    rests_inserted: s.kpis?.rests_inserted ?? null,
    window_violations: s.kpis?.window_violations ?? null,
  }));
}
