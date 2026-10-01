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

const DUPLICATE_LOOKBACK_DAYS = 90;

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
 * @param {{ today?: string }} [options]
 */
export function validateAvizFields(values = {}, fields = {}, { today } = {}) {
  const findings = [];
  const day = today || bucharestYmd();

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
    findings.push(finding({
      rule: 'date_missing',
      field: 'data_efectuare_cursa',
      title: 'Dată cursă lipsă',
      message: 'Data efectuării cursei lipsește.',
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
      findings.push(finding({
        rule: 'date_too_old',
        field: 'data_efectuare_cursa',
        severity: 'warning',
        title: 'Dată foarte veche',
        message: `Data ${dateYmd} e cu peste un an în urmă.`,
        source: 'rule_failed',
      }));
    }
  }

  const plateRaw = values.numar_auto;
  if (String(plateRaw || '').trim()) {
    const plate = normalizePlate(plateRaw) || (String(plateRaw).match(/\bTEST/i) ? String(plateRaw).trim() : null);
    if (!plate) {
      findings.push(finding({
        rule: 'plate_implausible',
        field: 'numar_auto',
        severity: 'warning',
        title: 'Plăcuță neverosimilă',
        message: `„${String(plateRaw).slice(0, 40)}” nu arată ca o plăcuță RO.`,
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
    }
  }

  // Low-confidence / missing critical OCR fields (routing signal).
  for (const key of ocrFieldKeys()) {
    const meta = fieldMeta(key);
    if (!meta) continue;
    const field = fields[key] || fields[key === 'cantitate_marfa' ? 'quantity' : key];
    const conf = field?.confidence;
    if (conf == null && !String(values[key] ?? '').trim()) {
      if (meta.critical) {
        findings.push(finding({
          rule: 'critical_low_confidence',
          field: key,
          title: `${meta.label} necunoscut`,
          message: `Câmpul critic ${meta.label} lipsește după OCR.`,
          source: 'low_confidence',
        }));
      }
      continue;
    }
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
    if (f.source === 'duplicate_suspect' || f.severity === 'error') {
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
} = {}) {
  const findings = validateAvizFields(values, fields, { today });

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
        title: 'Suspect de duplicat (90 zile)',
        message: `Același transport apare deja (${dup.filename || dup.id}).`,
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
