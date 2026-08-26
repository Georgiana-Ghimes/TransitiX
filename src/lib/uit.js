/**
 * Telling a real UIT from a local placeholder, on the screen side.
 *
 * A UIT is checked at the roadside, so the interface must never present a development stub as
 * though it were the real thing. The server marks both the code (a prefix) and the row
 * (`uit_source`); the prefix is what survives being printed, read out, or typed elsewhere, so
 * it is the fallback for rows written before the column existed.
 *
 * `STUB_PREFIX` mirrors the server constant in `server/src/lib/compliance/etransport.js`, and
 * `uit.test.js` asserts the two still agree.
 */

export const STUB_PREFIX = 'STUB-';

export function isStubUit(code) {
  return String(code || '').startsWith(STUB_PREFIX);
}

/** True when this route's UIT must not be treated as valid for transport. */
export function isPlaceholderUit(route) {
  if (!route?.uit_code) return false;
  if (route.uit_source === 'stub') return true;
  return isStubUit(route.uit_code);
}

export function uitBadge(route) {
  if (!route?.uit_code) return null;
  if (isPlaceholderUit(route)) {
    return {
      label: 'UIT DE TEST',
      tone: 'warn',
      title: 'Cod local de test — NU este un UIT valid pentru transport',
    };
  }
  return {
    label: `UIT ${route.uit_code}`,
    tone: 'ok',
    title: route.uit_status ? `UIT · ${route.uit_status}` : 'UIT',
  };
}
