/**
 * Faza 4 — the feedback loop.
 *
 * Every operator correction lands in `document_events` as `kind = 'corrected'` with a
 * `detail.field_changes[]` list, whether it came through the HITL drawer
 * (`PUT /documents/:id/corrections`) or the office edit form (`PUT /entities/AvizDocument`).
 * This module turns those events into the numbers that tell us whether OCR is earning its
 * keep: which fields people fix most, how often a document is touched at all, and whether
 * the confidence bands send too much (noise) or too little (misses) to review.
 *
 * Nothing here retrains anything. The output is read by a person who then adjusts a
 * profile, a band or a validation rule — the model is a vendor's, and a change we cannot
 * reproduce next month is not a change we want.
 */

import { DEFAULT_BANDS, ocrFieldKeys, fieldMeta, ROUTING } from './avizFieldSchema.js';

/** Fields the OCR writes and that count as a correction when a person changes them. */
export const FEEDBACK_FIELDS = Object.freeze(ocrFieldKeys());

/**
 * Minimum documents before a suggestion is spoken: a 100 % correction rate on two
 * documents is an anecdote, not a pattern.
 */
export const SUGGESTION_MIN_DOCS = 10;
/** A routing band is judged on its own sample; half the window is enough to say something. */
export const ROUTING_MIN_DOCS = 5;
/** A field corrected on more than this share of documents is a profile problem. */
export const FIELD_HOT_RATE = 0.3;
/** Optional-review documents nobody touched above this share means the band is too eager. */
export const NOISE_HOT_RATE = 0.7;
/** Auto documents still corrected above this share means the band is too lax. */
export const MISS_HOT_RATE = 0.15;

/** pg DATE is local midnight; the UTC form lands on the previous day east of Greenwich. */
function localDay(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function sameValue(a, b) {
  if (a == null && b == null) return true;
  if (a == null || b == null) return false;
  if (a instanceof Date || b instanceof Date) {
    const da = a instanceof Date ? a : new Date(a);
    const db = b instanceof Date ? b : new Date(b);
    if (!Number.isNaN(da.getTime()) && !Number.isNaN(db.getTime())) {
      // pg DATE comes back as local midnight; the form sends YYYY-MM-DD.
      return da.toDateString() === db.toDateString();
    }
  }
  const na = Number(a);
  const nb = Number(b);
  if (String(a).trim() !== '' && String(b).trim() !== '' && Number.isFinite(na) && Number.isFinite(nb)) {
    return Math.abs(na - nb) < 1e-9;
  }
  return String(a).trim() === String(b).trim();
}

/**
 * Field-level diff between the stored aviz row and an office-form payload, limited to the
 * OCR fields. Free-text notes (`observatii`) stay manual and never count as OCR feedback.
 *
 * @returns {Array<{field: string, old_value: *, new_value: *, operator_id: string|null, operator_name: string|null, timestamp: string}>}
 */
export function avizOcrFieldChanges(prev, data, user, { now = new Date() } = {}) {
  if (!prev || !data) return [];
  const out = [];
  const ts = now.toISOString();
  for (const field of FEEDBACK_FIELDS) {
    if (!Object.prototype.hasOwnProperty.call(data, field)) continue;
    const next = data[field];
    const before = prev[field];
    if (sameValue(before, next)) continue;
    out.push({
      field,
      old_value: before instanceof Date ? localDay(before) : before ?? null,
      new_value: next ?? null,
      operator_id: user?.id ?? null,
      operator_name: user?.name ?? user?.email ?? null,
      timestamp: ts,
    });
  }
  return out;
}

function changesOf(event) {
  const detail = event?.detail ?? {};
  if (Array.isArray(detail.field_changes)) {
    return detail.field_changes
      .filter((c) => c && c.field)
      .map((c) => ({ field: String(c.field), old_value: c.old_value ?? null, new_value: c.new_value ?? null }));
  }
  if (detail.corrections && typeof detail.corrections === 'object') {
    return Object.entries(detail.corrections).map(([field, value]) => ({ field, old_value: null, new_value: value }));
  }
  return [];
}

function rate(num, den) {
  if (!den) return null;
  return Math.round((num / den) * 1000) / 1000;
}

/**
 * @param {object} input
 * @param {Array<{document_id: string, detail: object, created_at?: *}>} input.events `corrected` events in the window
 * @param {Array<{id: string, routing: string|null, status: string, failed_rules?: string[]}>} input.documents documents extracted in the window
 * @returns {object} the feedback report
 */
export function summariseFeedback({ events = [], documents = [] } = {}) {
  const docById = new Map(documents.map((d) => [String(d.id), d]));
  const touched = new Set();
  const perField = new Map();
  const perOperator = new Map();
  let changesTotal = 0;

  for (const ev of events) {
    const docId = String(ev.document_id ?? '');
    const changes = changesOf(ev);
    if (!changes.length) continue;
    touched.add(docId);
    changesTotal += changes.length;
    const who = ev.user_name || ev.user_email || ev.detail?.field_changes?.[0]?.operator_name || null;
    if (who) perOperator.set(who, (perOperator.get(who) || 0) + changes.length);
    for (const c of changes) {
      const slot = perField.get(c.field) || { field: c.field, corrections: 0, docs: new Set(), examples: [] };
      slot.corrections += 1;
      slot.docs.add(docId);
      if (slot.examples.length < 3 && (c.old_value != null || c.new_value != null)) {
        slot.examples.push({ from: c.old_value, to: c.new_value });
      }
      perField.set(c.field, slot);
    }
  }

  const byRouting = {
    [ROUTING.AUTO]: { total: 0, touched: 0 },
    [ROUTING.HITL_OPTIONAL]: { total: 0, touched: 0 },
    [ROUTING.HITL_REQUIRED]: { total: 0, touched: 0 },
    unknown: { total: 0, touched: 0 },
  };
  const ruleCounts = new Map();
  for (const doc of documents) {
    const key = byRouting[doc.routing] ? doc.routing : 'unknown';
    byRouting[key].total += 1;
    if (touched.has(String(doc.id))) byRouting[key].touched += 1;
    for (const rule of doc.failed_rules ?? []) {
      ruleCounts.set(rule, (ruleCounts.get(rule) || 0) + 1);
    }
  }

  const totalDocs = documents.length;
  // Documents corrected but extracted before the window still count as touches; they are
  // not in `documents`, so the rate denominator is the union.
  const touchedInWindow = [...touched].filter((id) => docById.has(id)).length;
  const touchedOutside = touched.size - touchedInWindow;

  const fields = [...perField.values()]
    .map((slot) => ({
      field: slot.field,
      label: fieldMeta(slot.field)?.label ?? slot.field,
      critical: Boolean(fieldMeta(slot.field)?.critical),
      corrections: slot.corrections,
      documents: slot.docs.size,
      doc_rate: rate(slot.docs.size, totalDocs),
      examples: slot.examples,
    }))
    .sort((a, b) => b.documents - a.documents || b.corrections - a.corrections || a.field.localeCompare(b.field));

  const rules = [...ruleCounts.entries()]
    .map(([rule, count]) => ({ rule, documents: count, doc_rate: rate(count, totalDocs) }))
    .sort((a, b) => b.documents - a.documents || a.rule.localeCompare(b.rule));

  const routing = Object.fromEntries(
    Object.entries(byRouting).map(([k, v]) => [k, { ...v, touch_rate: rate(v.touched, v.total) }]),
  );

  const suggestions = [];
  if (totalDocs >= SUGGESTION_MIN_DOCS) {
    for (const f of fields) {
      if (f.doc_rate != null && f.doc_rate > FIELD_HOT_RATE) {
        suggestions.push({
          kind: 'field_hot',
          field: f.field,
          message: `„${f.label}” e corectat pe ${Math.round(f.doc_rate * 100)} % din documente — verifică profilul OCR (etichetă, poziție) înainte de a atinge pragurile.`,
        });
      }
    }
    const opt = routing[ROUTING.HITL_OPTIONAL];
    if (opt.total >= ROUTING_MIN_DOCS && opt.touch_rate != null && (1 - opt.touch_rate) > NOISE_HOT_RATE) {
      suggestions.push({
        kind: 'noise',
        message: `${Math.round((1 - opt.touch_rate) * 100)} % din documentele „verificare opțională” au fost confirmate fără nicio corecție — pragul optional (${DEFAULT_BANDS.optional}) poate coborî.`,
      });
    }
    const auto = routing[ROUTING.AUTO];
    if (auto.total >= ROUTING_MIN_DOCS && auto.touch_rate != null && auto.touch_rate > MISS_HOT_RATE) {
      suggestions.push({
        kind: 'miss',
        message: `${Math.round(auto.touch_rate * 100)} % din documentele trecute „auto” au avut totuși corecții — pragul auto e prea permisiv sau lipsește o regulă de validare.`,
      });
    }
    for (const r of rules) {
      if (r.doc_rate != null && r.doc_rate > 0.5) {
        suggestions.push({
          kind: 'rule_hot',
          rule: r.rule,
          message: `Regula „${r.rule}” pică pe ${Math.round(r.doc_rate * 100)} % din documente — ori documentele chiar sunt așa, ori regula e prea strictă.`,
        });
      }
    }
  }

  return {
    documents: {
      total: totalDocs,
      touched: touchedInWindow,
      touched_outside_window: touchedOutside,
      touch_rate: rate(touchedInWindow, totalDocs),
      corrections: changesTotal,
      corrections_per_touched_doc: rate(changesTotal, touched.size),
    },
    routing,
    fields,
    rules,
    operators: [...perOperator.entries()]
      .map(([name, corrections]) => ({ name, corrections }))
      .sort((a, b) => b.corrections - a.corrections),
    suggestions,
    enough_data: totalDocs >= SUGGESTION_MIN_DOCS,
    min_docs_for_suggestions: SUGGESTION_MIN_DOCS,
  };
}
