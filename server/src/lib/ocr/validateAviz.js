/**
 * Deterministic commercial validation for an extracted aviz (pre-confirm).
 *
 * OCR confidence says "characters look right"; these rules say "the annex would be wrong".
 */

import { consignmentKey } from '../avizQuery.js';
import { normalizePlate, normalizeTpo } from '../avizOcr.js';
import {
  ROUTING,
  confidenceBand,
  criticalOcrKeys,
  fieldMeta,
  ocrFieldKeys,
  worstRouting,
} from './avizFieldSchema.js';
import {
  detectHandCorrection,
  isAcceptableAutoField,
  isPlausibleLoadWeightKg,
  LOAD_WEIGHT_MIN_KG,
} from './fields.js';
import { avizDocumentKeys } from './splitPdf.js';

const DUPLICATE_LOOKBACK_DAYS = 90;

/**
 * Two (or more) distinct avize in one OCR blob — typical side-by-side driver photo (#59).
 * Splitting a single JPEG is not available; force HITL so mixed values never look clean.
 *
 * @param {string} text
 * @returns {{ document_numbers: string[], tpo_numbers: string[] } | null}
 */
export function detectMultipleAvizeInText(text) {
  const document_numbers = [...avizDocumentKeys(text)].sort();
  const tpo_numbers = [];
  const seen = new Set();
  const re = /\b(?:TPO|TP0|TPQ|TPD|IPO|7PO)[\s\-._/:]*(\d{3,}(?:[-/.]\d+)*)/gi;
  let m;
  while ((m = re.exec(String(text || '')))) {
    const norm = normalizeTpo(`TPO-${String(m[1]).replace(/[/.]/g, '-')}`, 3);
    if (!norm || seen.has(norm)) continue;
    seen.add(norm);
    tpo_numbers.push(norm);
  }
  tpo_numbers.sort();
  if (document_numbers.length < 2 && tpo_numbers.length < 2) return null;
  return { document_numbers, tpo_numbers };
}

/** Bucharest calendar YYYY-MM-DD. */
export function bucharestYmd(date = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Bucharest',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

function addDaysYmd(ymd, days) {
  const [y, m, d] = String(ymd).split('-').map(Number);
  const utc = new Date(Date.UTC(y, m - 1, d + days));
  return utc.toISOString().slice(0, 10);
}

/** Accept ISO date or DD.MM.YYYY / DD/MM/YYYY → YYYY-MM-DD. */
export function parseAvizDate(value) {
  const s = String(value || '').trim();
  if (!s) return null;
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const dmy = s.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{4})$/);
  if (dmy) {
    const dd = dmy[1].padStart(2, '0');
    const mm = dmy[2].padStart(2, '0');
    return `${dmy[3]}-${mm}-${dd}`;
  }
  return null;
}

function finding({
  rule,
  severity = 'error',
  field = null,
  title,
  message,
  source = 'rule_failed',
}) {
  return {
    rule,
    severity,
    field,
    title,
    message,
    source,
  };
}

/**
 * Sync field / format rules (no DB).
 * @param {object} values column-shaped values
 * @param {object} [fields] extract field objects { confidence, status, value }
 * @param {{ today?: string, rawText?: string }} [options]
 */
export function validateAvizFields(values = {}, fields = {}, { today, rawText } = {}) {
  const findings = [];
  const day = today || bucharestYmd();

  const multi = detectMultipleAvizeInText(rawText);
  if (multi) {
    const labels = [
      ...multi.document_numbers.slice(0, 4),
      ...multi.tpo_numbers.slice(0, 4),
    ];
    const seen = new Set();
    const unique = labels.filter((x) => (seen.has(x) ? false : (seen.add(x), true)));
    findings.push(finding({
      rule: 'multiple_avize_in_image',
      severity: 'error',
      field: null,
      title: 'Mai multe avize în aceeași poză',
      message: unique.length
        ? `Poza conține mai multe avize (${unique.join(', ')}). Separă-le în poze distincte — valorile pot fi amestecate.`
        : 'Poza conține mai multe avize. Separă-le în poze distincte — valorile pot fi amestecate.',
      source: 'rule_failed',
    }));
  }

  // Printed figures struck with pen + handwritten fix (#65). Force HITL even if OCR kept the print.
  if (detectHandCorrection(rawText).present) {
    findings.push(finding({
      rule: 'hand_correction_on_document',
      severity: 'error',
      field: 'cantitate_marfa',
      title: 'Corectură pe document',
      message: 'Pe aviz există o corectură de mână (valori tăiate). Verifică Cantitatea — tipăritul poate fi greșit.',
      source: 'rule_failed',
    }));
    findings.push(finding({
      rule: 'hand_correction_on_document',
      severity: 'error',
      field: 'gross_weight_kg',
      title: 'Corectură pe document',
      message: 'Pe aviz există o corectură de mână (valori tăiate). Verifică Greutatea brută — tipăritul poate fi greșit.',
      source: 'rule_failed',
    }));
  }

  const tpoRaw = values.numar_tpo;
  const tpo = normalizeTpo(tpoRaw, 1);
  if (!String(tpoRaw || '').trim()) {
    findings.push(finding({
      rule: 'tpo_missing',
      field: 'numar_tpo',
      title: 'TPO lipsă',
      message: 'Fără număr TPO avizul nu poate fi legat de anexă.',
      source: 'rule_failed',
    }));
  } else if (!tpo) {
    findings.push(finding({
      rule: 'tpo_invalid',
      field: 'numar_tpo',
      title: 'TPO invalid',
      message: `„${String(tpoRaw).slice(0, 48)}” nu arată ca un TPO.`,
      source: 'rule_failed',
    }));
  }

  const dateRaw = values.data_efectuare_cursa;
  const dateYmd = parseAvizDate(dateRaw);
  if (!String(dateRaw || '').trim()) {
    // Folded corner / glare often hides „Data avizului…” — empty is correct; HITL must ask to type it (#81).
    findings.push(finding({
      rule: 'date_missing',
      field: 'data_efectuare_cursa',
      title: 'Dată cursă lipsă',
      message: 'Data efectuării cursei lipsește pe poză (colț îndoit / OCR) — completează manual Data efectuare cursă.',
      source: 'rule_failed',
    }));
  } else if (!dateYmd) {
    findings.push(finding({
      rule: 'date_unparseable',
      field: 'data_efectuare_cursa',
      title: 'Dată cursă necunoscută',
      message: `Nu am putut citi data „${String(dateRaw).slice(0, 32)}”.`,
      source: 'rule_failed',
    }));
  } else {
    const maxOk = addDaysYmd(day, 1);
    const minOk = addDaysYmd(day, -400);
    if (dateYmd > maxOk) {
      findings.push(finding({
        rule: 'date_in_future',
        field: 'data_efectuare_cursa',
        title: 'Dată în viitor',
        message: `Data ${dateYmd} este după ${maxOk}.`,
        source: 'rule_failed',
      }));
    } else if (dateYmd < minOk) {
      // OCR often turns 2026→2020; a multi-year-old trip date on a fresh upload is an error (#77).
      findings.push(finding({
        rule: 'date_too_old',
        field: 'data_efectuare_cursa',
        severity: 'error',
        title: 'Dată foarte veche',
        message: `Data ${dateYmd} e cu peste un an în urmă — verifică anul pe poză (OCR confundă des 6 cu 0).`,
        source: 'rule_failed',
      }));
    }
  }

  const plateRaw = values.numar_auto;
  if (String(plateRaw || '').trim()) {
    const plate = normalizePlate(plateRaw)
      || (String(plateRaw).match(/\bTEST/i) ? String(plateRaw).trim() : null);
    if (!plate || !isAcceptableAutoField(plate)) {
      findings.push(finding({
        rule: 'plate_implausible',
        field: 'numar_auto',
        severity: 'warning',
        title: 'Plăcuță neverosimilă',
        message: `„${String(plateRaw).slice(0, 40)}” nu arată ca o plăcuță cunoscută (RO sau UE).`,
        source: 'rule_failed',
      }));
    }
  } else {
    findings.push(finding({
      rule: 'plate_missing',
      field: 'numar_auto',
      severity: 'warning',
      title: 'Nr. auto lipsă',
      message: 'Fără plăcuță, cursa e greu de legat de flotă.',
      source: 'rule_failed',
    }));
  }

  const docRaw = String(values.numar_document_marfa || '').trim();
  if (docRaw && !/^(?:PSL|TRO|TEST-AVZ)[-.\s]?\d/i.test(docRaw)) {
    // House numbers ("220") that slipped past OCR must not look confirmed (#54).
    findings.push(finding({
      rule: 'doc_no_invalid',
      field: 'numar_document_marfa',
      severity: 'warning',
      title: 'Nr. document fără format PSL/TRO',
      message: `„${docRaw.slice(0, 40)}” nu arată ca un număr de aviz (PSL-/TRO-).`,
      source: 'rule_failed',
    }));
  } else if (
    !docRaw
    && /(?:aviz\s+de\s+expedi[tț]ie|comand[aă]\s+de\s+transfer)/i.test(String(rawText || ''))
  ) {
    // Label visible but code lost to glare / TRO→TPO misread left empty (#75).
    findings.push(finding({
      rule: 'doc_no_missing',
      field: 'numar_document_marfa',
      severity: 'error',
      title: 'Nr. document marfă lipsă',
      message: 'Pe poză există „Aviz de expediție” / „Comanda de transfer”, dar numărul (PSL-/TRO-) nu s-a citit — verifică pe poză.',
      source: 'rule_failed',
    }));
  }

  const qty = values.cantitate_marfa;
  if (qty != null && String(qty).trim() !== '') {
    const n = Number(String(qty).replace(',', '.'));
    if (!Number.isFinite(n) || n <= 0) {
      findings.push(finding({
        rule: 'quantity_invalid',
        field: 'cantitate_marfa',
        severity: 'warning',
        title: 'Cantitate invalidă',
        message: 'Cantitatea trebuie să fie un număr pozitiv.',
        source: 'rule_failed',
      }));
    }
  }

  for (const key of ['gross_weight_kg', 'net_weight_kg']) {
    const w = values[key];
    if (w == null || String(w).trim() === '') continue;
    const n = Number(w);
    if (!Number.isFinite(n) || n <= 0) {
      findings.push(finding({
        rule: 'weight_invalid',
        field: key,
        severity: 'warning',
        title: 'Greutate invalidă',
        message: `${fieldMeta(key)?.label || key} trebuie să fie un număr pozitiv.`,
        source: 'rule_failed',
      }));
      continue;
    }
    // Gross of 12 kg is usually CMR box 12 (volume), not the weighbridge (#66).
    if (key === 'gross_weight_kg' && !isPlausibleLoadWeightKg(n)) {
      findings.push(finding({
        rule: 'weight_implausible_low',
        field: key,
        severity: 'error',
        title: 'Greutate brută neverosimilă',
        message: n < LOAD_WEIGHT_MIN_KG
          ? `${n} kg e prea mică pentru un transport — verifică căsuța 11 (greutate), nu 12.`
          : `${n} kg nu poate fi greutatea brută a unui camion.`,
        source: 'rule_failed',
      }));
    }
  }

  // Gross below net cannot be right (stain / OCR dropping a thousands digit → #73).
  {
    const gross = Number(values.gross_weight_kg);
    const net = Number(values.net_weight_kg);
    if (
      Number.isFinite(gross)
      && Number.isFinite(net)
      && gross > 0
      && net > 0
      && gross + 0.05 < net
    ) {
      findings.push(finding({
        rule: 'gross_below_net',
        field: 'gross_weight_kg',
        severity: 'error',
        title: 'Greutate brută sub netă',
        message: `Brută ${gross} kg e sub neta ${net} kg — cifra e probabil ilizibilă; verifică pe poză.`,
        source: 'rule_failed',
      }));
    }
  }

  // Net filled but gross empty while the page names „Greutate brută” — coffee stain / OCR miss (#74).
  {
    const grossRaw = values.gross_weight_kg;
    const net = Number(values.net_weight_kg);
    const grossEmpty = grossRaw == null || String(grossRaw).trim() === '';
    const hasGrossLabel = /greutate\s*(?:bruta|brută)|masa\s*(?:bruta|brută)|gross\s*weight/i.test(
      String(rawText || ''),
    );
    if (grossEmpty && Number.isFinite(net) && net > 0 && hasGrossLabel) {
      findings.push(finding({
        rule: 'gross_missing_near_net',
        field: 'gross_weight_kg',
        severity: 'error',
        title: 'Greutate brută ilizibilă',
        message: `Neta e ${net} kg, dar greutatea brută lipsește — verifică pe poză (pată / OCR). Fără brută nu se calculează taxa zonă.`,
        source: 'rule_failed',
      }));
    }
  }

  // Tip + Cantitate both empty while the page clearly has a goods table (#76).
  {
    const tipEmpty = !String(values.tip_marfa || '').trim();
    const qtyEmpty = !String(values.cantitate_marfa ?? values.quantity ?? '').trim();
    const raw = String(rawText || '');
    const hasGoodsTable = (
      /\b11\d{5,7}\b/.test(raw)
      || /\b(?:cantitate|ambalaj|descriere)\b/i.test(raw)
      || /\b\d{2}\s*kg\b/i.test(raw)
    );
    if (tipEmpty && qtyEmpty && hasGoodsTable) {
      findings.push(finding({
        rule: 'goods_missing',
        field: 'cantitate_marfa',
        severity: 'error',
        title: 'Tip marfă / Cantitate lipsă',
        message: 'Pe poză există tabel de marfă, dar tipul și cantitatea nu s-au citit — verifică pe poză (lumină / OCR).',
        source: 'rule_failed',
      }));
      findings.push(finding({
        rule: 'goods_missing',
        field: 'tip_marfa',
        severity: 'error',
        title: 'Tip marfă / Cantitate lipsă',
        message: 'Pe poză există tabel de marfă, dar tipul și cantitatea nu s-au citit — verifică pe poză (lumină / OCR).',
        source: 'rule_failed',
      }));
    }
  }

  // Low-confidence OCR fields (routing signal). Empty values are covered by dedicated
  // missing rules (date_missing, tpo_missing, …) — do not also emit „Scor OCR 0%” (#81).
  for (const key of ocrFieldKeys()) {
    const meta = fieldMeta(key);
    if (!meta) continue;
    const field = fields[key] || fields[key === 'cantitate_marfa' ? 'quantity' : key];
    const conf = field?.confidence;
    if (!String(values[key] ?? '').trim()) continue;
    if (conf == null) continue;
    const band = confidenceBand(key, conf);
    if (band === ROUTING.HITL_REQUIRED) {
      findings.push(finding({
        rule: 'critical_low_confidence',
        field: key,
        severity: meta.critical ? 'error' : 'warning',
        title: `${meta.label}: încredere scăzută`,
        message: `Scor OCR ${(Number(conf) * 100).toFixed(0)}% — sub pragul de acceptare.`,
        source: 'low_confidence',
      }));
    } else if (band === ROUTING.HITL_OPTIONAL) {
      findings.push(finding({
        rule: 'field_review_band',
        field: key,
        severity: 'warning',
        title: `${meta.label}: de verificat`,
        message: `Scor OCR ${(Number(conf) * 100).toFixed(0)}% — verificare opțională.`,
        source: 'low_confidence',
      }));
    }
  }

  return findings;
}

/**
 * Duplicate consignment within the last 90 days (same company).
 */
export async function findDuplicateSuspect(queryFn, {
  companyId,
  row,
  excludeId = null,
  lookbackDays = DUPLICATE_LOOKBACK_DAYS,
} = {}) {
  const tpo = String(row?.numar_tpo || '').trim();
  if (!tpo || !companyId) return null;

  const result = await queryFn(
    `SELECT id, numar_tpo, numar_document_marfa, ruta_transport, data_efectuare_cursa,
            numar_auto, trip_id, original_filename, created_at
     FROM aviz_documents
     WHERE company_id = $1
       AND LOWER(TRIM(numar_tpo)) = LOWER(TRIM($2))
       AND created_at >= NOW() - ($3::int * INTERVAL '1 day')
       AND ($4::uuid IS NULL OR id <> $4::uuid)
     ORDER BY created_at DESC
     LIMIT 50`,
    [companyId, tpo, lookbackDays, excludeId]
  );

  const key = consignmentKey(row);
  const match = result.rows.find((other) => consignmentKey(other) === key);
  if (!match) return null;
  return {
    id: match.id,
    filename: match.original_filename,
    numar_tpo: match.numar_tpo,
    created_at: match.created_at,
  };
}

/**
 * Combine field findings + confidence into routing.
 */
export function computeRouting({ fields = {}, findings = [] } = {}) {
  let routing = ROUTING.AUTO;

  for (const f of findings) {
    // Suspect duplicate is an info badge only — it must not force HITL / block Confirm.
    if (f.source === 'duplicate_suspect' || f.severity === 'info') continue;
    if (f.severity === 'error') {
      routing = worstRouting(routing, ROUTING.HITL_REQUIRED);
    } else if (f.severity === 'warning') {
      routing = worstRouting(routing, ROUTING.HITL_OPTIONAL);
    }
  }

  for (const key of ocrFieldKeys()) {
    const field = fields[key] || fields[key === 'cantitate_marfa' ? 'quantity' : key];
    if (!field || field.confidence == null) {
      if (criticalOcrKeys().includes(key) && !String(field?.value ?? '').trim()) {
        routing = worstRouting(routing, ROUTING.HITL_REQUIRED);
      }
      continue;
    }
    routing = worstRouting(routing, confidenceBand(key, field.confidence));
  }

  return routing;
}

/**
 * Full validation package stored on extracted_data.validation.
 */
export async function validateAvizExtraction({
  values,
  fields,
  companyId,
  documentId,
  queryFn,
  today,
  rawText,
} = {}) {
  const findings = validateAvizFields(values, fields, { today, rawText });

  if (queryFn && companyId) {
    const dup = await findDuplicateSuspect(queryFn, {
      companyId,
      row: values,
      excludeId: documentId,
    });
    if (dup) {
      findings.push(finding({
        rule: 'duplicate_consignment_90d',
        field: 'numar_tpo',
        severity: 'info',
        title: 'Suspect de duplicat (90 zile)',
        message: `Același transport apare deja (${dup.filename || dup.id}). Nu blochează confirmarea.`,
        source: 'duplicate_suspect',
      }));
      findings[findings.length - 1].duplicate_of = dup.id;
    }
  }

  const routing = computeRouting({ fields, findings });
  const failed_rules = [...new Set(findings.map((f) => f.rule))];
  const needs_review = routing !== ROUTING.AUTO
    || findings.some((f) => f.severity === 'error');

  return {
    findings,
    routing,
    failed_rules,
    needs_review,
    validated_at: new Date().toISOString(),
  };
}

export { DUPLICATE_LOOKBACK_DAYS, ROUTING };
