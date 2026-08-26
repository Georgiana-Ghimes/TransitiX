/**
 * Provider-agnostic confidence scoring for a geocoding result.
 *
 * Extracted from the Photon client so a second provider produces numbers on the same scale.
 * That matters: the whole pipeline — auto-accept at 0.8, review at 0.45, the colours on
 * `/locations` — compares these values without caring who returned them. Two providers each
 * with their own idea of "confidence" would quietly break every one of those thresholds.
 *
 * Candidates arrive already normalized by their provider into the shape below; nothing here
 * knows about OSM tags or TomTom result types.
 */

import { streetNameTokens, stripDiacritics } from './address.js';

/** Below this a pin is never written unattended. */
export const AUTO_ACCEPT_CONFIDENCE = 0.8;

/** How precisely the provider claims to have resolved the address. */
export const PRECISION_BASE = {
  address: 0.55,
  street: 0.4,
  locality: 0.25,
  other: 0.2,
};

const PRECISION_REASON = {
  address: 'nivel_adresa',
  street: 'nivel_strada',
  locality: 'nivel_localitate',
  other: 'nivel_imprecis',
};

function round2(value) {
  return Math.round(value * 100) / 100;
}

function norm(value) {
  return stripDiacritics(String(value || ''))
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/**
 * Precision of a candidate. Providers may state it directly; otherwise it is inferred from
 * what came back, which is what the Photon client relied on before this was shared.
 */
export function candidatePrecision(candidate) {
  if (candidate?.precision && PRECISION_BASE[candidate.precision]) return candidate.precision;
  if (candidate?.housenumber) return 'address';
  if (candidate?.street) return 'street';
  if (candidate?.osm_key === 'place') return 'locality';
  return 'other';
}

/**
 * How much do we trust this candidate for the address we asked about?
 *
 * Precision sets the ceiling (a house beats a street beats a village), then agreement with
 * the query moves it up or down.
 */
export function scoreCandidate(parsed, candidate) {
  const reasons = [];
  if (!candidate) return { score: 0, reasons: ['fara_rezultat'] };

  // Anything outside Romania is a wrong answer, however confident it looks.
  if (candidate.countrycode && candidate.countrycode.toUpperCase() !== 'RO') {
    return { score: 0, reasons: ['alta_tara'] };
  }

  const precision = candidatePrecision(candidate);
  let score = PRECISION_BASE[precision];
  reasons.push(PRECISION_REASON[precision]);

  const wantCity = norm(parsed?.city);
  const gotCity = norm(candidate.city);
  if (wantCity && gotCity) {
    if (wantCity === gotCity) { score += 0.2; reasons.push('oras_potrivit'); }
    else if (gotCity.includes(wantCity) || wantCity.includes(gotCity)) {
      score += 0.1;
      reasons.push('oras_partial');
    } else { score -= 0.15; reasons.push('oras_diferit'); }
  }

  // Compare street *names* only. Including the type word would match "Calea Aradului"
  // against "Calea Torontalului" on the shared "calea" and score two different streets
  // as a perfect hit.
  const wantStreet = streetNameTokens(parsed?.street);
  const gotStreet = streetNameTokens(candidate.street);
  if (wantStreet.length && gotStreet.length) {
    const overlap = wantStreet.filter((want) => gotStreet.some((got) => (
      got === want
      // tolerate inflection ("Arad" / "Aradului") without matching unrelated names
      || (want.length >= 4 && got.length >= 4 && (got.includes(want) || want.includes(got)))
    )));
    if (overlap.length) { score += 0.1; reasons.push('strada_potrivita'); }
    // A different street is disqualifying, not a minor deduction: it must not survive
    // into auto-accept even when city and house number both agree.
    else { score -= 0.3; reasons.push('strada_diferita'); }
  }

  if (parsed?.houseNumber && candidate.housenumber) {
    if (norm(parsed.houseNumber) === norm(candidate.housenumber)) {
      score += 0.15;
      reasons.push('numar_potrivit');
    } else { score -= 0.1; reasons.push('numar_diferit'); }
  } else if (parsed?.houseNumber && !candidate.housenumber) {
    reasons.push('numar_negasit');
  }

  if (parsed?.postcode && candidate.postcode && parsed.postcode === candidate.postcode) {
    score += 0.05;
    reasons.push('cod_postal_potrivit');
  }

  return { score: round2(Math.max(0, Math.min(1, score))), reasons };
}

/** Ranks normalized candidates best-first, attaching the score to each. */
export function rankCandidates(parsed, candidates = []) {
  return candidates
    .filter(Boolean)
    .map((candidate) => {
      const { score, reasons } = scoreCandidate(parsed, candidate);
      return { ...candidate, confidence: score, reasons };
    })
    .sort((a, b) => b.confidence - a.confidence);
}

export function buildSearchResult(parsed, candidates = []) {
  const ranked = rankCandidates(parsed, candidates);
  return {
    candidates: ranked,
    best: ranked[0] || null,
    // Only a clear winner may be written without a human looking at it.
    autoAcceptable: Boolean(ranked[0] && ranked[0].confidence >= AUTO_ACCEPT_CONFIDENCE),
  };
}
