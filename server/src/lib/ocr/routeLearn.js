/**
 * Company-local route learning from office Editează corrections.
 *
 * When an operator fixes `ruta_transport`, we store a regex over the address tokens in that
 * document's OCR text. The next extract whose raw text matches those tokens gets the learned
 * route — no model training, just reproducible pattern match per company.
 */

import {
  originFromSiteDepozit,
  parseDeliveryAddress,
} from '../avizOcr.js';

/** Tokens that appear on every Baumit page and must never become a match key. */
const TOKEN_NOISE = new Set([
  'str', 'strada', 'nr', 'numar', 'ro', 'rou', 'romania', 'sector',
  'site', 'depozit', 'pagina', 'client',
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
 * Build match material: tokens + a joined regex (for storage / debugging).
 * Matching uses tokens AND-ed via {@link textMatchesTokens}, not the joined string alone.
 * @returns {{ tokens: string[], matchRegex: string }|null}
 */
export function buildRouteRuleFromOcr(rawText) {
  const tokens = addressTokensFromOcr(rawText);
  if (tokens.length < MIN_LEARN_TOKENS) return null;
  // Stored as token1.*token2 style documentation; real match uses match_tokens.
  const matchRegex = tokens.map((t) => tokenPattern(t)).join('&&');
  return { tokens, matchRegex };
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
 */
export function applyLearnedRoute(values, rawText, rules, { correctedFields = [] } = {}) {
  const out = { ...(values || {}) };
  if (correctedFields.includes('ruta_transport')) {
    return { values: out, learned: false, rule: null };
  }
  const rule = matchRouteRule(rawText, rules);
  if (!rule?.ruta_transport) {
    return { values: out, learned: false, rule: null };
  }
  out.ruta_transport = rule.ruta_transport;
  return { values: out, learned: true, rule };
}

/**
 * For list/decorate: when a rule matches and the office did not pin ruta_transport,
 * show the learned value (same address → same route). Never overrides corrected_fields.
 */
export function preferLearnedRoute(storedRoute, rawText, rules, { corrected = false } = {}) {
  if (corrected) return { route: storedRoute, learned: false, rule: null };
  const rule = matchRouteRule(rawText, rules);
  if (!rule?.ruta_transport) {
    return { route: storedRoute, learned: false, rule: null };
  }
  const same = String(storedRoute || '').trim() === String(rule.ruta_transport).trim();
  return {
    route: rule.ruta_transport,
    learned: !same,
    rule,
  };
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
