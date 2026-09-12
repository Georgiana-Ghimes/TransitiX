/**
 * Observation codes for avize (DM, ZA, ZB, IF…).
 *
 * `*` is only a join separator when several codes land in the Observații cell —
 * it must never be stored as part of the catalog code.
 */

/** Letters/digits, optional one colon group (e.g. Z:B). No *, /, spaces, free prose. */
const CODE_PATTERN = /^[A-Z0-9]{1,12}(?::[A-Z0-9]{1,12})?$/;

/**
 * Strip report separators and noise, then uppercase.
 * `IF*` / `Z:B*` → `IF` / `Z:B`.
 */
export function normalizeObservationCode(raw) {
  let text = String(raw ?? '').trim().toUpperCase();
  if (!text) return '';
  // Trailing stars are Excel join markers, not part of the code.
  text = text.replace(/\*+$/g, '');
  // Collapse inner whitespace; reject later if any remain via the pattern.
  text = text.replace(/\s+/g, '');
  return text;
}

export function isValidObservationCodeFormat(code) {
  return CODE_PATTERN.test(String(code || ''));
}

/**
 * @returns {{ ok: true, code: string, label: string } | { ok: false, message: string }}
 */
export function validateObservationCodeInput({ code, label } = {}) {
  const normalized = normalizeObservationCode(code);
  if (!normalized) {
    return { ok: false, message: 'Completează codul.' };
  }
  if (!isValidObservationCodeFormat(normalized)) {
    return {
      ok: false,
      message: 'Cod invalid. Folosește litere/cifre (opțional un grup cu :), fără * sau alte separatoare. Ex: IF, ZB, Z:B, DM.',
    };
  }
  const desc = String(label ?? '').trim();
  if (!desc) {
    return { ok: false, message: 'Completează descrierea codului.' };
  }
  if (desc.length > 120) {
    return { ok: false, message: 'Descrierea e prea lungă (max. 120 caractere).' };
  }
  return { ok: true, code: normalized, label: desc };
}

/** Join selected catalog codes for the Observații cell / Excel. */
export function joinObservationCodes(codes = []) {
  const parts = [];
  const seen = new Set();
  for (const raw of codes) {
    const code = normalizeObservationCode(raw);
    if (!code || !isValidObservationCodeFormat(code) || seen.has(code)) continue;
    seen.add(code);
    parts.push(code);
  }
  return parts.join('*');
}

/**
 * Append one catalog code to an existing Observații string.
 * Accepts legacy space-separated or *-separated lists.
 */
export function appendObservationCode(current, nextCode) {
  const next = normalizeObservationCode(nextCode);
  if (!next || !isValidObservationCodeFormat(next)) return String(current || '').trim();
  const existing = String(current || '')
    .split(/[*]+|\s+/)
    .map((p) => normalizeObservationCode(p))
    .filter(Boolean);
  if (existing.includes(next)) return existing.join('*');
  return joinObservationCodes([...existing, next]);
}
