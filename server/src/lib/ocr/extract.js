/**
 * Extraction pipeline:
 *
 *   document type -> OCR profile -> field extraction -> confidence -> manual correction
 *
 * Confidence decides what happens next. Above the accept threshold a field is filled in;
 * below it the field is still filled but flagged, so an operator sees a pre-filled form
 * rather than an empty one — and knows exactly which boxes to check.
 */

import { overallConfidence } from './fields.js';
import { normalizeOcrText } from './normalizeOcrText.js';
import { detectProfile, getProfile, normaliseExtracted } from './profiles.js';

/** At or above this, a field is trusted without review. */
export const ACCEPT_CONFIDENCE = 0.8;
/** Below this, the value is too weak to pre-fill at all. */
export const REJECT_CONFIDENCE = 0.35;

export function fieldStatus(confidence) {
  const value = Number(confidence) || 0;
  if (value >= ACCEPT_CONFIDENCE) return 'ok';
  if (value >= REJECT_CONFIDENCE) return 'review';
  return 'missing';
}

/**
 * Runs one profile over a text.
 *
 * A field whose extractor throws is reported as missing rather than taking the whole
 * document down — one bad regex must not lose the other eleven fields.
 */
export function extractWithProfile(text, profile) {
  const fields = {};
  for (const [name, extractor] of Object.entries(profile.fields ?? {})) {
    try {
      const found = extractor(text) ?? { value: null, confidence: 0, matched: null };
      fields[name] = {
        value: found.value ?? null,
        confidence: Math.round((found.confidence ?? 0) * 100) / 100,
        matched: found.matched ?? null,
        status: fieldStatus(found.confidence),
      };
    } catch (err) {
      fields[name] = { value: null, confidence: 0, matched: null, status: 'missing', error: err.message };
    }
  }
  return normaliseExtracted(fields);
}

/**
 * Full extraction for one document.
 *
 * @param {string} text        OCR or PDF text layer
 * @param {object} options
 * @param {string} [options.documentType]  narrows which profiles are considered
 * @param {string} [options.profileId]     forces a profile, overriding detection
 */
export function extractDocument(text, { documentType, profileId } = {}) {
  const raw = normalizeOcrText(text);

  const forced = profileId ? getProfile(profileId) : null;
  const detection = detectProfile(raw, { documentType });
  const profile = forced ?? detection.profile;

  if (!profile) {
    return {
      profile_id: null,
      profile_name: null,
      document_type: documentType ?? null,
      detection_score: detection.score,
      fields: {},
      values: {},
      confidence: 0,
      status: 'unrecognised',
      needs_review: true,
      candidates: detection.candidates.map((c) => ({ id: c.profile.id, name: c.profile.name, score: c.score })),
    };
  }

  const fields = extractWithProfile(raw, profile);
  const confidence = overallConfidence(fields, profile.weights);

  // Only values worth showing are pre-filled; anything weaker stays out of the form.
  const values = {};
  for (const [name, field] of Object.entries(fields)) {
    if (field.status !== 'missing') values[name] = field.value;
  }

  const reviewFields = Object.entries(fields)
    .filter(([, field]) => field.status !== 'ok')
    .map(([name]) => name);

  return {
    profile_id: profile.id,
    profile_name: profile.name,
    document_type: profile.documentType,
    detection_score: forced ? null : detection.score,
    forced_profile: Boolean(forced),
    fields,
    values,
    confidence,
    status: confidence >= ACCEPT_CONFIDENCE ? 'ok' : 'review',
    needs_review: confidence < ACCEPT_CONFIDENCE || reviewFields.length > 0,
    review_fields: reviewFields,
    candidates: detection.candidates.map((c) => ({ id: c.profile.id, name: c.profile.name, score: c.score })),
  };
}

/**
 * The extractor and the review screen do not use the same word for the same thing.
 *
 * The extractor calls it `quantity`; it is stored in the column `cantitate_marfa`, which is what
 * the operator sees and therefore what the operator corrects. Without this mapping the
 * correction landed on a field the extractor had never heard of, the original `quantity` stayed
 * `missing`, and the document could never leave review — a dead end on every aviz whose quantity
 * failed to extract.
 */
export const FIELD_ALIASES = Object.freeze({ cantitate_marfa: 'quantity' });

export function canonicalFieldName(name) {
  return FIELD_ALIASES[name] ?? name;
}

/**
 * Merges an operator's corrections over an extraction.
 *
 * Corrected fields are recorded by name and pinned to full confidence: a human looked at the
 * document, which outranks any pattern match. Re-running OCR later must not undo them.
 */
export function applyCorrections(extraction, corrections = {}, { previouslyCorrected = [] } = {}) {
  const corrected = new Set(previouslyCorrected);
  const fields = { ...extraction.fields };
  const values = { ...extraction.values };

  for (const [rawName, value] of Object.entries(corrections)) {
    if (value === undefined) continue;
    const name = canonicalFieldName(rawName);
    // Both spellings are recorded so a screen that highlights corrected fields keeps working
    // whichever name it knows, but only the canonical field carries the value.
    corrected.add(name);
    if (rawName !== name) corrected.add(rawName);
    fields[name] = { value, confidence: 1, matched: null, status: 'ok', source: 'manual' };
    values[name] = value;
    if (rawName !== name) {
      delete fields[rawName];
      delete values[rawName];
    }
  }

  const reviewFields = Object.entries(fields)
    .filter(([, field]) => field.status !== 'ok')
    .map(([name]) => name);

  return {
    ...extraction,
    fields,
    values,
    corrected_fields: [...corrected],
    review_fields: reviewFields,
    needs_review: reviewFields.length > 0,
  };
}

/**
 * Re-extraction that keeps human corrections.
 * This is what "Re-extrage" must do — otherwise it silently discards an operator's work.
 */
export function reExtract(text, { documentType, profileId, corrections = {}, correctedFields = [] } = {}) {
  const fresh = extractDocument(text, { documentType, profileId });
  const keep = {};
  for (const name of correctedFields) {
    const canonical = canonicalFieldName(name);
    if (corrections[canonical] !== undefined) keep[canonical] = corrections[canonical];
  }
  return applyCorrections(fresh, keep, { previouslyCorrected: correctedFields });
}

/** Compact summary for a batch review list. */
export function summariseExtraction(extraction) {
  return {
    profile_id: extraction.profile_id,
    profile_name: extraction.profile_name,
    confidence: extraction.confidence,
    status: extraction.status,
    needs_review: extraction.needs_review,
    review_fields: extraction.review_fields ?? [],
    filled: Object.values(extraction.fields ?? {}).filter((f) => f.status !== 'missing').length,
    total: Object.keys(extraction.fields ?? {}).length,
  };
}
