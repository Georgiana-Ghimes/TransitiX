/**
 * RO e-Transport (UIT).
 *
 * A UIT is a legal requirement: for the goods categories the law names, a vehicle without one is
 * stopped and the carrier is fined. That makes this the one adapter where a convincing
 * placeholder is more dangerous than no feature at all — a code that *looks* like a UIT and is
 * not one gets discovered at the roadside, by a driver who has no way to tell.
 *
 * So there are three modes and no silent fallback between them:
 *
 *   off   — do not request anything; the route launches without a UIT and says so
 *   stub  — issue a local, deliberately-marked placeholder for development
 *   anaf  — call ANAF for a real one, and fail loudly if it cannot
 *
 * `anaf` with missing credentials is an error, never a quiet downgrade to `stub`.
 */

import crypto from 'crypto';

/**
 * The prefix that makes a placeholder impossible to mistake for the real thing.
 *
 * A real UIT never starts with this. It is on the code itself rather than on a flag beside it,
 * because the code is what gets printed on a road sheet, read over the phone, and typed into
 * someone else's system — every one of which drops the flag and keeps the string.
 */
export const STUB_PREFIX = 'STUB-';

export function isStubUit(code) {
  return String(code || '').startsWith(STUB_PREFIX);
}

export function etransportMode() {
  const mode = String(process.env.ETRANSPORT_MODE || 'stub').trim().toLowerCase();
  if (mode === 'off' || mode === 'false' || mode === '0') return 'off';
  if (mode === 'anaf' || mode === 'live' || mode === 'production') return 'anaf';
  return 'stub';
}

export function etransportConfigured() {
  return etransportMode() !== 'off';
}

/** What the health endpoint reports, so nobody reads "on" as "issuing real codes". */
export function etransportCapability() {
  const mode = etransportMode();
  if (mode !== 'anaf') return mode;
  return anafCredentials() ? 'anaf' : 'anaf-unconfigured';
}

function anafCredentials() {
  const token = String(process.env.ANAF_ETRANSPORT_TOKEN || '').trim();
  const baseUrl = String(process.env.ANAF_ETRANSPORT_URL || '').trim();
  if (!token || !baseUrl) return null;
  return { token, baseUrl: baseUrl.replace(/\/+$/, '') };
}

/**
 * The declaration ANAF expects, built from a route.
 *
 * Kept as a pure function so its shape can be tested and reviewed against the spec without a
 * certificate — the part that needs ANAF to verify is the transport, not the content.
 */
export function buildUitDeclaration(route, { company, stops = [] } = {}) {
  return {
    codDeclarant: company?.fiscal_code || company?.cui || null,
    numeDeclarant: company?.name || null,
    tipOperatie: 'AIC',
    dataTransport: String(route?.route_date ?? '').slice(0, 10) || null,
    nrVehicul: route?.vehicle_plate || null,
    refIntern: route?.code || route?.id || null,
    locStart: stops[0]?.name ?? null,
    locFinal: stops.length ? stops[stops.length - 1].name : null,
    nrPuncteDescarcare: stops.filter((s) => s.kind === 'livrare').length || null,
  };
}

/** Recognises the shape ANAF returns, without pretending to know more than the docs say. */
function readAnafResponse(payload) {
  const uit = payload?.UIT ?? payload?.uit ?? payload?.codUIT ?? null;
  if (uit) return { ok: true, status: 'obtained', uit_code: String(uit) };
  const message = payload?.mesaj ?? payload?.message ?? payload?.Errors?.[0]?.errorMessage ?? null;
  return { ok: false, status: 'failed', message: message || 'ANAF nu a returnat un UIT' };
}

async function requestFromAnaf(route, { company, stops }) {
  const creds = anafCredentials();
  if (!creds) {
    // Loud, not quiet: an operator who set ETRANSPORT_MODE=anaf believes real codes are being
    // issued. Handing back a placeholder here is how a fake UIT reaches a roadside check.
    return {
      ok: false,
      status: 'failed',
      message: 'ETRANSPORT_MODE=anaf, dar lipsesc ANAF_ETRANSPORT_URL / ANAF_ETRANSPORT_TOKEN. '
        + 'Nu se emite niciun cod până când certificatul e configurat.',
    };
  }

  try {
    const res = await fetch(`${creds.baseUrl}/upload`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${creds.token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(buildUitDeclaration(route, { company, stops })),
      signal: AbortSignal.timeout(20_000),
    });
    const payload = await res.json().catch(() => null);
    if (!res.ok) {
      return {
        ok: false,
        status: 'failed',
        message: `ANAF a răspuns ${res.status}: ${payload?.mesaj ?? payload?.message ?? 'eroare necunoscută'}`,
      };
    }
    return readAnafResponse(payload);
  } catch (err) {
    return {
      ok: false,
      status: 'failed',
      message: `ANAF inaccesibil: ${err?.message || err}`,
    };
  }
}

/**
 * Request a UIT for a launched route.
 *
 * @returns {{ ok, uit_code?, status, message?, stub?, source }}
 */
export async function requestUitForRoute(route, { company, stops = [] } = {}) {
  const mode = etransportMode();

  if (mode === 'off') {
    return {
      ok: false,
      status: 'none',
      source: 'off',
      message: 'e-Transport este dezactivat (ETRANSPORT_MODE=off)',
    };
  }

  if (mode === 'anaf') {
    return { ...await requestFromAnaf(route, { company, stops }), source: 'anaf', stub: false };
  }

  // Deterministic from route id + date so re-launching a route does not mint a second code.
  const seed = `${company?.id || 'co'}:${route.id}:${route.route_date}`;
  const hash = crypto.createHash('sha256').update(seed).digest('hex').slice(0, 16).toUpperCase();

  return {
    ok: true,
    status: 'obtained',
    uit_code: `${STUB_PREFIX}RO${hash}`,
    stub: true,
    source: 'stub',
    message: 'Cod local de test, NU un UIT valid. Nu îl folosi pe documente de transport — '
      + 'setează ETRANSPORT_MODE=anaf și credențialele ANAF pentru coduri reale.',
  };
}
