/**
 * Company-local route learning from office Editează corrections.
 *
 * When an operator fixes `ruta_transport`, we store a regex over the address tokens in that
 * document's OCR text. The next extract whose raw text matches those tokens gets the learned
 * route — no model training, just reproducible pattern match per company.
 */

import {
  formatAddressLine,
  originFromSiteDepozit,
  parseDeliveryAddress,
} from '../avizOcr.js';
import { isPlausibleAddressLeg } from './addressMemory.js';

/** Tokens that appear on every Baumit page and must never become a match key. */
const TOKEN_NOISE = new Set([
  'str', 'strada', 'nr', 'numar', 'ro', 'rou', 'romania', 'sector',
  'site', 'depozit', 'depozite', 'pagina', 'client',
  'expeditor', 'adresa', 'livrare', 'aviz', 'transport', 'buc', 'kg',
]);

/** Minimum distinctive tokens before we store a rule (one token matches half the warehouse). */
export const MIN_LEARN_TOKENS = 2;

function fold(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/ș|ş|Ș|Ş/g, 's')
    .replace(/ț|ţ|Ț|Ţ/g, 't')
    .toLowerCase();
}

function escapeRegex(token) {
  return String(token).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Word-ish boundary that still matches hyphenated tokens (`bolintin-deal`).
 * `\b` breaks on the hyphen because `-` is non-word.
 * Stored as a per-token pattern; matching tests every token (AND), not one mega-lookahead
 * — engines choke when many `(?=.*…)` groups meet tokens like `mil-`.
 */
function tokenPattern(token) {
  const esc = escapeRegex(token);
  return `(?:^|[^a-z0-9])${esc}(?:[^a-z0-9]|$)`;
}

function pushToken(set, raw) {
  const folded = fold(raw).trim();
  if (!folded) return;
  // Split hyphenated place names into whole token (bolintin-deal stays one match unit).
  for (const part of folded.split(/[^a-z0-9\-]+/).filter(Boolean)) {
    if (part.length < 2) continue;
    if (TOKEN_NOISE.has(part)) continue;
    // Allow short house numbers / site codes (1f, mil) — mil/bol are in noise alone;
    // site codes come via originFromSiteDepozit as MIL-NEAMTIU parts below.
    set.add(part);
  }
}

/**
 * Distinctive address tokens from Expeditor Site/Depozit + Adresa de livrare.
 * @returns {string[]}
 */
export function addressTokensFromOcr(rawText) {
  const tokens = new Set();
  const delivery = parseDeliveryAddress(rawText);
  if (delivery?.streetName) pushToken(tokens, delivery.streetName);
  if (delivery?.houseNumber) pushToken(tokens, delivery.houseNumber);
  if (delivery?.locality) pushToken(tokens, delivery.locality);

  const siteOrigin = originFromSiteDepozit(rawText);
  // Site/Depozit codes (MIL, NEAMTIU) — always kept; they are the load-origin fingerprint.
  if (siteOrigin) {
    for (const part of fold(siteOrigin).split('-').filter(Boolean)) {
      if (part.length >= 2) tokens.add(part);
    }
  }

  return [...tokens].sort();
}

/**
 * Primary street word from a route delivery leg (`… / Șosea Viilor nr. 52, Bucuresti` → `viilor`).
 * Used to refuse a learned Iancu rule on a page that clearly says Viilor.
 */
export function primaryStreetTokenFromRoute(ruta) {
  const parts = String(ruta || '').split(/\s*\/\s*/).map((p) => p.trim()).filter(Boolean);
  const delivery = parts.length >= 2 ? parts[parts.length - 1] : parts[0] || '';
  const folded = fold(delivery)
    .replace(/\bnr\.?\s*\d+[a-z]?\b/g, ' ')
    .replace(/\b\d{5,6}\b/g, ' ')
    .replace(/\b(str|strada|sosea|soseaua|sos|bvd|blvd|bd|bulevardul|aleea|piata|calea|sector|bucuresti)\b/g, ' ');
  const words = folded.split(/[^a-z0-9]+/).filter((w) => w.length >= 4 && !TOKEN_NOISE.has(w) && !/^\d+$/.test(w));
  return words[0] || null;
}

export function primaryStreetTokenFromOcr(rawText) {
  const delivery = parseDeliveryAddress(rawText);
  if (!delivery?.streetName) return null;
  const words = fold(delivery.streetName)
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length >= 4 && !TOKEN_NOISE.has(w));
  return words[0] || null;
}

/**
 * Build match material: tokens + a joined regex (for storage / debugging).
 * Matching uses tokens AND-ed via {@link textMatchesTokens}, not the joined string alone.
 *
 * Refuses rules without a delivery street name — `bol`+`bucuresti` alone matched every
 * Bolintin→București aviz and rewrote Șos. Viilor as Bvd. Iancu de Hunedoara on re-extract.
 * @returns {{ tokens: string[], matchRegex: string }|null}
 */
export function buildRouteRuleFromOcr(rawText) {
  const delivery = parseDeliveryAddress(rawText);
  if (!delivery?.streetName) return null;
  const tokens = addressTokensFromOcr(rawText);
  if (tokens.length < MIN_LEARN_TOKENS) return null;
  // Street fingerprint must stay in the key (not only site + city).
  const streetTok = primaryStreetTokenFromOcr(rawText);
  if (!streetTok || !tokens.includes(streetTok)) return null;
  // Stored as token1.*token2 style documentation; real match uses match_tokens.
  const matchRegex = tokens.map((t) => tokenPattern(t)).join('&&');
  return { tokens, matchRegex };
}

/** House number of the delivery leg of a route (`… / Calea Dorobantilor nr. 135A, Bucuresti` → `135a`). */
function houseFromRoute(ruta) {
  const parts = String(ruta || '').split(/\s+\/\s+/);
  const leg = parts[parts.length - 1] || '';
  return fold(leg.match(/\bnr\.?\s*([0-9][^\s,]*)/i)?.[1] || '') || null;
}

/**
 * True when a learned route would replace something the structural parser already read clearly
 * from Adresa de livrare:
 *   - a different street (Viilor on the page vs learned Iancu);
 *   - the same street with a different house number. A correction 135 → 135A on one aviz must
 *     not rewrite the next aviz that prints nr. 135 clearly; that page is the better witness.
 * A misread page (company name as street, `nr. 5OS`) is not clear, so the rule still repairs it.
 */
export function learnedRouteConflictsWithOcr(rawText, learnedRuta) {
  return learnedRouteConflictReason(rawText, learnedRuta) != null;
}

/**
 * Why {@link learnedRouteConflictsWithOcr} refuses: `conflict_street`, `conflict_house`, or null
 * when the learned route may be used. Route telemetry records it.
 */
export function learnedRouteConflictReason(rawText, learnedRuta) {
  const ocrStreet = primaryStreetTokenFromOcr(rawText);
  const learnedStreet = primaryStreetTokenFromRoute(learnedRuta);
  if (!ocrStreet || !learnedStreet) return null;
  if (ocrStreet !== learnedStreet) return 'conflict_street';
  const delivery = parseDeliveryAddress(rawText);
  const ocrHouse = fold(delivery?.houseNumber || '') || null;
  const learnedHouse = houseFromRoute(learnedRuta);
  if (!ocrHouse || !learnedHouse || ocrHouse === learnedHouse) return null;
  // Only a number printed as `nr. 135` counts: with no number the parser can borrow the `1`
  // of `Sector 1`, and that is no reason to refuse the office's route.
  const escaped = ocrHouse.replace(/[.*+?^${}()|[\]\\/-]/g, '\\$&');
  if (!new RegExp(`\\bnr\\.?\\s*${escaped}\\b`, 'i').test(fold(rawText))) return null;
  return isPlausibleAddressLeg(formatAddressLine(delivery)) ? 'conflict_house' : null;
}

/** True when every token appears in folded OCR with word-ish boundaries. */
export function textMatchesTokens(rawText, tokens) {
  const list = Array.isArray(tokens) ? tokens : [];
  if (!list.length) return false;
  const folded = fold(rawText);
  if (!folded.trim()) return false;
  for (const token of list) {
    const t = fold(token);
    if (!t) return false;
    let re;
    try {
      re = new RegExp(tokenPattern(t), 'i');
    } catch {
      return false;
    }
    if (!re.test(folded)) return false;
  }
  return true;
}

/**
 * Pick the best matching rule for folded OCR text.
 * Most tokens win; ties → newer updated_at.
 */
export function matchRouteRule(rawText, rules = []) {
  if (!rules.length) return null;

  let best = null;
  let bestScore = -1;
  let bestUpdated = 0;

  for (const rule of rules) {
    let tokens = rule.match_tokens;
    if (typeof tokens === 'string') {
      try { tokens = JSON.parse(tokens); } catch { tokens = []; }
    }
    if (!Array.isArray(tokens) || !tokens.length) continue;
    if (!textMatchesTokens(rawText, tokens)) continue;

    const tokenCount = tokens.length;
    const updated = rule.updated_at ? new Date(rule.updated_at).getTime() : 0;
    if (
      tokenCount > bestScore
      || (tokenCount === bestScore && updated >= bestUpdated)
    ) {
      best = rule;
      bestScore = tokenCount;
      bestUpdated = updated;
    }
  }
  return best;
}

/**
 * Apply a matched rule onto extraction values (mutates a shallow copy).
 * Skips when ruta_transport is in correctedFields (office pinned this document).
 * Skips when Adresa de livrare already names a different street than the learned route.
 */
export function applyLearnedRoute(values, rawText, rules, { correctedFields = [], trace } = {}) {
  const out = { ...(values || {}) };
  if (correctedFields.includes('ruta_transport')) {
    traceRule(trace, { result: 'skipped', reason: 'corrected_fields_skip' });
    return { values: out, learned: false, rule: null };
  }
  const rule = pickUsableRule(rawText, rules, trace);
  if (!rule) return { values: out, learned: false, rule: null };
  out.ruta_transport = rule.ruta_transport;
  traceRule(trace, { result: 'used', rule_id: rule.id ?? null });
  return { values: out, learned: true, rule };
}

/**
 * For list/decorate: when a rule matches and the office did not pin ruta_transport,
 * show the learned value (same address → same route). Never overrides corrected_fields.
 * Never replaces a clear OCR street with a different learned street.
 */
export function preferLearnedRoute(storedRoute, rawText, rules, { corrected = false, trace } = {}) {
  if (corrected) {
    traceRule(trace, { result: 'skipped', reason: 'corrected_fields_skip' });
    return { route: storedRoute, learned: false, rule: null };
  }
  const rule = pickUsableRule(rawText, rules, trace);
  if (!rule) return { route: storedRoute, learned: false, rule: null };
  const same = String(storedRoute || '').trim() === String(rule.ruta_transport).trim();
  traceRule(trace, { result: 'used', rule_id: rule.id ?? null, ...(same ? { same_as_stored: true } : {}) });
  return {
    route: rule.ruta_transport,
    learned: !same,
    rule,
  };
}

function traceRule(trace, entry) {
  if (Array.isArray(trace)) trace.push({ step: 'route_rule', ...entry });
}

/**
 * The matched rule when it may be used, else null. Refusals go to `trace`:
 * `no_rules` / `no_match` (skipped), `rule_without_route`, `conflict_street`, `conflict_house`.
 */
function pickUsableRule(rawText, rules, trace) {
  if (!rules?.length) {
    traceRule(trace, { result: 'skipped', reason: 'no_rules' });
    return null;
  }
  const rule = matchRouteRule(rawText, rules);
  if (!rule) {
    traceRule(trace, { result: 'skipped', reason: 'no_match', rules: rules.length });
    return null;
  }
  if (!rule.ruta_transport) {
    traceRule(trace, { result: 'refused', reason: 'rule_without_route', rule_id: rule.id ?? null });
    return null;
  }
  const conflict = learnedRouteConflictReason(rawText, rule.ruta_transport);
  if (conflict) {
    traceRule(trace, { result: 'refused', reason: conflict, rule_id: rule.id ?? null });
    return null;
  }
  return rule;
}

/** Load all route rules for a company (newest first for stable tie-break in SQL too). */
export async function listRouteRules(queryFn, companyId) {
  const { rows } = await queryFn(
    `SELECT id, company_id, match_regex, match_tokens, ruta_transport,
            source_document_id, hits, created_at, updated_at
     FROM aviz_route_rules
     WHERE company_id = $1
     ORDER BY jsonb_array_length(match_tokens) DESC, updated_at DESC`,
    [companyId]
  );
  return rows.map((r) => ({
    ...r,
    match_tokens: Array.isArray(r.match_tokens) ? r.match_tokens : [],
  }));
}

/**
 * Upsert a learned rule from an office correction.
 * @returns {Promise<object|null>} the saved rule, or null if not enough tokens
 */
export async function learnRouteFromCorrection(queryFn, {
  companyId,
  documentId,
  rawText,
  rutaTransport,
} = {}) {
  const route = String(rutaTransport || '').trim();
  if (!route || !companyId || !rawText) return null;

  const built = buildRouteRuleFromOcr(rawText);
  if (!built) return null;

  const { rows } = await queryFn(
    `INSERT INTO aviz_route_rules (
       company_id, match_regex, match_tokens, ruta_transport, source_document_id, hits
     ) VALUES ($1, $2, $3::jsonb, $4, $5, 0)
     ON CONFLICT (company_id, match_regex) DO UPDATE SET
       ruta_transport = EXCLUDED.ruta_transport,
       match_tokens = EXCLUDED.match_tokens,
       source_document_id = EXCLUDED.source_document_id,
       updated_at = NOW()
     RETURNING *`,
    [
      companyId,
      built.matchRegex,
      JSON.stringify(built.tokens),
      route,
      documentId || null,
    ]
  );
  const row = rows[0];
  if (!row) return null;
  return {
    ...row,
    match_tokens: Array.isArray(row.match_tokens) ? row.match_tokens : built.tokens,
  };
}

/** Increment hit counter after a successful apply (best-effort). */
export async function recordRouteRuleHit(queryFn, ruleId) {
  if (!ruleId) return;
  await queryFn(
    `UPDATE aviz_route_rules SET hits = hits + 1, updated_at = updated_at WHERE id = $1`,
    [ruleId]
  );
}
