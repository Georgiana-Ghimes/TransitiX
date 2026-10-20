import { APP_BUILD } from '@/lib/appVersion';

/** @deprecated Prefer {@link WHATS_NEW_SEEN_KEY}; still read for migration. */
export const WHATS_NEW_SEEN_BUILD_KEY = 'transitix_whats_new_seen_build';

/** localStorage JSON: `{ build, ip }` for the last dismissed „Ce este nou?”. */
export const WHATS_NEW_SEEN_KEY = 'transitix_whats_new_seen';

/** Only the newest N releases stay in the modal and in `WHATS_NEW_RELEASES`. */
export const WHATS_NEW_KEEP = 5;

/**
 * Client-facing release notes, newest builds first in the array is fine —
 * {@link sortReleasesNewestFirst} normalizes order for the modal.
 *
 * Keep wording plain: what the office person gains, not how we built it.
 * Cap at {@link WHATS_NEW_KEEP}: when adding a build, drop the oldest.
 *
 * @typedef {{ build: number, version?: string, dateLabel?: string, title: string, highlights: string[] }} WhatsNewRelease
 * @typedef {{ build: number|null, ip: string|null }} WhatsNewSeen
 */

/** @type {WhatsNewRelease[]} */
export const WHATS_NEW_RELEASES = [
  {
    build: 127,
    version: '1.28.2',
    dateLabel: 'octombrie 2026',
    title: '„Ce este nou?” ușor de închis pe telefon',
    highlights: [
      'Pe telefon, fereastra „Ce este nou?” e scurtă: poți închide cu X sau Gata, fără să umple tot ecranul.',
      'La deschiderea automată vezi doar ultima actualizare; din meniu rămân toate notele recente.',
      'În aplicația de șofer acest mesaj nu mai apare.',
    ],
  },
  {
    build: 126,
    version: '1.28.1',
    dateLabel: 'octombrie 2026',
    title: 'Rotire vizibilă + rută din CP București',
    highlights: [
      'După 90° sau 180°, preview-ul din Editează arată fișierul rotit (nu mai anulează vizual rotația).',
      'Dacă OCR citește greșit orașul (ex. Timișoara) dar CP-ul e București (01–06), ruta folosește București — fără CP în textul rutei.',
    ],
  },
  {
    build: 125,
    version: '1.28.0',
    dateLabel: 'octombrie 2026',
    title: 'Login clar; livrare/taxă; listă fără salt',
    highlights: [
      'La autentificare greșită vezi motivul real (parolă, cont dezactivat…), nu „sesiune expirată”. Google poate fi ascuns din configurare.',
      'Adresa de livrare și taxa de zonă: doar descărcarea (nu Expeditor / Client din dreapta); taxa se recalculează când editezi Rută.',
      'Re-extrage apare deasupra documentului când merită; #102 dată din alt an marcată; preview mai puțin întors greșit.',
      'În listă, Editează / Verifică / Re-extrage nu mai mută avizul din locul lui.',
    ],
  },
  {
    build: 120,
    version: '1.26.14',
    dateLabel: 'octombrie 2026',
    title: 'Acțiuni compacte, zoom PDF, porți TPO/OCR strânse',
    highlights: [
      'În listă: un singur buton Acțiuni (Editează, Verifică, Confirmă, Re-extrage, Șterge) în loc de stivă de linkuri.',
      'În Editează: zoom pe document (− / % / +) și Descarcă fișierul stocat.',
      'Cu „Unește celulele TPO” pe șablon: fără Număr TPO nu poți nici Confirma, nici Uni (doar „Doar document marfă” sau oprești bifa).',
      'Confirmă pe server nu mai trece peste OCR nesigur pe TPO, nici cu „oricum”: trebuie Verifică / Salvează pe document.',
    ],
  },
  {
    build: 119,
    version: '1.26.13',
    dateLabel: 'octombrie 2026',
    title: 'TRO / document marfă în carusel',
    highlights: [
      'La Unește / Confirmă: vezi și Număr document marfă (TRO/PSL), nu doar TPO.',
      'Bifă „Doar document marfă (fără TPO pe pagină)” pentru avize de transfer: TPO nu e obligatoriu; în Anexă rămân la coada listei după TPO-uri.',
    ],
  },
];

export function parseBuild(value) {
  if (value == null || value === '') return null;
  const n = Number(String(value).trim());
  if (!Number.isFinite(n)) return null;
  return Math.trunc(n);
}

/** Normalize for compare: trim, lower-case IPv6, strip IPv4-mapped prefix. */
export function normalizeIp(value) {
  let s = String(value || '').trim().toLowerCase();
  if (!s) return null;
  if (s.startsWith('::ffff:')) s = s.slice('::ffff:'.length);
  return s || null;
}

/**
 * True when both sides have an IP and they differ.
 * Missing IP on either side does not count as a change (avoids spam after deploy / offline).
 */
export function whatsNewIpChanged(seenIp, currentIp) {
  const a = normalizeIp(seenIp);
  const b = normalizeIp(currentIp);
  if (!a || !b) return false;
  return a !== b;
}

export function sortReleasesNewestFirst(releases = WHATS_NEW_RELEASES) {
  return [...releases].sort((a, b) => (b.build || 0) - (a.build || 0));
}

/** Newest-first, capped at {@link WHATS_NEW_KEEP}. */
export function keepNewestWhatsNewReleases(
  releases = WHATS_NEW_RELEASES,
  keep = WHATS_NEW_KEEP,
) {
  const n = Number(keep);
  const limit = Number.isFinite(n) && n > 0 ? Math.floor(n) : WHATS_NEW_KEEP;
  return sortReleasesNewestFirst(releases).slice(0, limit);
}

/**
 * Releases the user has not dismissed yet (build strictly greater than last seen),
 * and not newer than the build currently running (so we never advertise the future).
 */
export function unseenReleases(
  seenBuild,
  currentBuild = APP_BUILD,
  releases = WHATS_NEW_RELEASES,
) {
  const seen = parseBuild(seenBuild);
  const current = parseBuild(currentBuild);
  if (current == null) return [];
  return sortReleasesNewestFirst(releases).filter((r) => {
    const b = parseBuild(r.build);
    if (b == null || b > current) return false;
    if (seen == null) return true;
    return b > seen;
  });
}

/** @returns {WhatsNewSeen} */
export function getSeenWhatsNew() {
  try {
    const raw = localStorage.getItem(WHATS_NEW_SEEN_KEY);
    if (raw) {
      try {
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === 'object') {
          return {
            build: parseBuild(parsed.build),
            ip: normalizeIp(parsed.ip),
          };
        }
      } catch {
        // fall through to legacy
      }
    }
    const legacy = parseBuild(localStorage.getItem(WHATS_NEW_SEEN_BUILD_KEY));
    return { build: legacy, ip: null };
  } catch {
    return { build: null, ip: null };
  }
}

/** @deprecated Use {@link getSeenWhatsNew}. */
export function getSeenWhatsNewBuild() {
  return getSeenWhatsNew().build;
}

/**
 * Effective seen build for filtering: null when the network changed, so notes show again.
 * @param {WhatsNewSeen|null} [seen]
 * @param {string|null|undefined} currentIp
 */
export function effectiveSeenBuild(seen = getSeenWhatsNew(), currentIp) {
  const record = seen || { build: null, ip: null };
  if (whatsNewIpChanged(record.ip, currentIp)) return null;
  return record.build;
}

export function markWhatsNewSeen(build = APP_BUILD, ip = null) {
  const n = parseBuild(build);
  if (n == null) return;
  const normalized = normalizeIp(ip);
  try {
    localStorage.setItem(
      WHATS_NEW_SEEN_KEY,
      JSON.stringify({ build: n, ip: normalized }),
    );
    // Keep legacy key in sync so older tabs / code paths stay consistent.
    localStorage.setItem(WHATS_NEW_SEEN_BUILD_KEY, String(n));
  } catch {
    // ignore quota / private mode
  }
}

/**
 * Auto-open on a new build, or again when the same browser connects from another IP.
 */
export function shouldAutoOpenWhatsNew(
  currentBuild = APP_BUILD,
  releases = WHATS_NEW_RELEASES,
  currentIp = null,
) {
  const seen = getSeenWhatsNew();
  const effective = effectiveSeenBuild(seen, currentIp);
  return unseenReleases(effective, currentBuild, releases).length > 0;
}

/**
 * @param {{
 *   all?: boolean,
 *   currentBuild?: string|number,
 *   releases?: WhatsNewRelease[],
 *   currentIp?: string|null,
 *   limit?: number|null,
 * }} [opts] `limit` caps the list (auto-open uses 1 so phones stay usable).
 */
export function releasesForModal({
  all = false,
  currentBuild = APP_BUILD,
  releases = WHATS_NEW_RELEASES,
  currentIp = null,
  limit = null,
} = {}) {
  const current = parseBuild(currentBuild);
  const known = keepNewestWhatsNewReleases(releases).filter((r) => {
    const b = parseBuild(r.build);
    if (b == null) return false;
    if (current == null) return true;
    return b <= current;
  });
  const list = all
    ? known
    : keepNewestWhatsNewReleases(
      unseenReleases(effectiveSeenBuild(getSeenWhatsNew(), currentIp), currentBuild, known),
    );
  const n = Number(limit);
  if (Number.isFinite(n) && n > 0) return list.slice(0, Math.floor(n));
  return list;
}

/** Client IP as seen by the API (first hop / X-Forwarded-For). */
export async function fetchWhatsNewClientIp(fetchImpl = fetch) {
  try {
    const res = await fetchImpl('/api/health', { method: 'GET', cache: 'no-store' });
    if (!res.ok) return null;
    const body = await res.json();
    return normalizeIp(body?.clientIp);
  } catch {
    return null;
  }
}
