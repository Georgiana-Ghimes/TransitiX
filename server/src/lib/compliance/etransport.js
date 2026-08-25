/**
 * e-Transport UIT — adapter with a local stub until ANAF credentials exist.
 *
 * Set ETRANSPORT_MODE=stub (default) or ETRANSPORT_MODE=off.
 * Real SPV/ANAF wiring is a later drop; this keeps the launch path honest.
 */

import crypto from 'crypto';

export function etransportMode() {
  const mode = String(process.env.ETRANSPORT_MODE || 'stub').trim().toLowerCase();
  if (mode === 'off' || mode === 'false' || mode === '0') return 'off';
  return 'stub';
}

export function etransportConfigured() {
  return etransportMode() !== 'off';
}

/**
 * Request a UIT for a launched route.
 * @returns {{ ok, uit_code?, status, message?, stub? }}
 */
export async function requestUitForRoute(route, { company } = {}) {
  const mode = etransportMode();
  if (mode === 'off') {
    return {
      ok: false,
      status: 'none',
      message: 'e-Transport este dezactivat (ETRANSPORT_MODE=off)',
    };
  }

  // Stub: deterministic-looking UIT from route id + date so re-launch is stable.
  const seed = `${company?.id || 'co'}:${route.id}:${route.route_date}`;
  const hash = crypto.createHash('sha256').update(seed).digest('hex').slice(0, 16).toUpperCase();
  const uit = `RO${hash}`;

  return {
    ok: true,
    status: 'obtained',
    uit_code: uit,
    stub: true,
    message: 'UIT generat local (stub) — înlocuiește cu ANAF când certificatul e gata',
  };
}
