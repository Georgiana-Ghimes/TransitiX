import { APP_BUILD } from '@/lib/appVersion';

/** @deprecated Prefer {@link WHATS_NEW_SEEN_KEY}; still read for migration. */
export const WHATS_NEW_SEEN_BUILD_KEY = 'transitix_whats_new_seen_build';

/** localStorage JSON: `{ build, ip }` for the last dismissed „Ce este nou?”. */
export const WHATS_NEW_SEEN_KEY = 'transitix_whats_new_seen';

/**
 * Client-facing release notes, newest builds first in the array is fine —
 * {@link sortReleasesNewestFirst} normalizes order for the modal.
 *
 * Keep wording plain: what the office person gains, not how we built it.
 *
 * @typedef {{ build: number, version?: string, dateLabel?: string, title: string, highlights: string[] }} WhatsNewRelease
 * @typedef {{ build: number|null, ip: string|null }} WhatsNewSeen
 */

/** @type {WhatsNewRelease[]} */
export const WHATS_NEW_RELEASES = [
  {
    build: 112,
    version: '1.26.6',
    dateLabel: 'octombrie 2026',
    title: 'Anexa Baumit: TPO-uri unite cum trebuie',
    highlights: [
      'Pe șablon: bifă „Unește celulele TPO”. În Excel, cursele aceluiași TPO sunt grupate și Număr TPO e sudat pe verticală. Nu mai rămân rupte dacă în listă erau amestecate cu alte TPO-uri.',
      'La Unește în Anexă sau Confirmă selectate: dacă lipsesc TPO / dată / auto / rută, treci documentele unul câte unul (preview + formular). Salvezi și treci la următorul; butonul de salvare rămâne jos, la vedere.',
      'Când totul e complet, Unește / Confirmă din josul ferestrei. Dacă tot vrei să continui cu goluri, poți: îți asumi.',
      'Cu bifă ON, în preview paginile adiacente cu același TPO apar lipite (ca pe un aviz multi-pagină).',
      'PDF cu mai multe avize: continuările pe același document rămân un fișier; în listă vezi intervalul de pagini (ex. pag. 6/7).',
    ],
  },
  {
    build: 110,
    version: '1.26.4',
    dateLabel: 'octombrie 2026',
    title: 'Avizele se văd cum trebuie',
    highlights: [
      'Deschizi un PDF și îl vezi în fereastră, inclusiv pe telefon. Fără ecran gol.',
      'Corectezi, apeși Salvează, și textul rămâne pe loc. Nu mai dispare din senin.',
      'Pozele apar lângă câmpuri, la fel ca PDF-urile.',
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
 * @param {{ all?: boolean, currentBuild?: string|number, releases?: WhatsNewRelease[], currentIp?: string|null }} [opts]
 */
export function releasesForModal({
  all = false,
  currentBuild = APP_BUILD,
  releases = WHATS_NEW_RELEASES,
  currentIp = null,
} = {}) {
  const current = parseBuild(currentBuild);
  const known = sortReleasesNewestFirst(releases).filter((r) => {
    const b = parseBuild(r.build);
    if (b == null) return false;
    if (current == null) return true;
    return b <= current;
  });
  if (all) return known;
  return unseenReleases(effectiveSeenBuild(getSeenWhatsNew(), currentIp), currentBuild, releases);
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
