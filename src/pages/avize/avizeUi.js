import { AVIZ_FORM_FIELDS } from '@/lib/avizAnnex';
import { toDateIso } from '@/lib/utils';

export const inputCls = 'w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:border-[#1D4E89] transition-colors';
export const labelCls = 'block text-xs font-medium text-slate-600 mb-1';

export const AVIZ_ACTION_LEGEND = [
  {
    name: 'Încarcă avize / Foto',
    text: 'Adaugă PDF-ul sau poza avizului. Sistemul citește TPO, dată, auto, rută, cantitate. Km, taxe, valoare TPO și observații se completează manual.',
  },
  {
    name: 'Editează',
    text: 'Corectează extracția sau completează câmpurile care nu sunt pe aviz (km, tarif, taxe, observații). Salvarea rămâne după refresh. Deasupra pozei e banda verde Re-extrage — apasă când OCR-ul a greșit (umbră, moiré) ca să citească din nou din document.',
  },
  {
    name: 'Confirmă',
    text: 'Marchează rândul ca verificat (status Confirmat). Dacă există câmpuri de verificat, apare un modal cu carousel pe documentele problematice: poți corecta pe loc sau confirma oricum (îți asumi câmpurile goale). „Suspect de duplicat” e doar etichetă, nu blochează.',
  },
  {
    name: 'Verificare OCR',
    text: 'Deschide documentul lângă toate câmpurile citite din aviz (TPO, auto, dată, rută, tip marfă, cantitate, greutăți, document marfă). Salvează corecțiile (audit old→new) apoi Marchează verificat. Preview-ul se derulează ca să vezi toată pagina.',
  },
  {
    name: 'Re-extrage',
    text: 'Citește din nou fișierul și rescrie TPO, dată, auto, rută, cantitate, document din PDF. Km, taxe, valoare TPO, observațiile și ruta de birou rămân. Folosește-l doar dacă vrei valorile din aviz, nu cele din Editează.',
  },
  {
    name: 'Șterge',
    text: 'Scoate avizul din listă. Folosește-l pentru dubluri, teste sau documente încărcate greșit. Nu se poate anula.',
  },
  {
    name: 'Șterge selectate',
    text: 'Bifează mai multe rânduri, apoi Șterge selectate. Confirmarea e obligatorie; după ștergere selecția se golește. Nu se poate anula.',
  },
  {
    name: 'Paginare',
    text: 'Lista arată 20, 50, 100 sau 500 de avize pe pagină (alegerea se ține minte). Selectarea rămâne peste pagini până schimbi filtrele; „selectează tot” bifează doar pagina curentă.',
  },
  {
    name: 'Aviz duplicat',
    text: 'Același transport există deja pe alt rând, adică același număr de aviz (PSL/TRO) sub același TPO. Un TPO cu mai multe curse nu primește eticheta: acelea sunt avize diferite și rămân rânduri separate. Eticheta e informativă: nu forțează verificare și nu blochează Confirmă / Unește. Pentru încărcări greșite, folosește Șterge.',
  },
  {
    name: 'Text roșu bold (OCR nesigur)',
    text: 'TPO, auto sau rută în roșu bold înseamnă că OCR-ul nu e sigur (ștampilă peste text, citire slabă, format ciudat). Nu înseamnă „editat manual”. Confirmă / Unește sunt blocate până verifici pe document (Verifică → Marchează verificat, sau Salvează în carusel). Un TPO greșit ajunge în grupul greșit din Excel. Pe Auto: dacă mașina e în Autoturisme cu MTMA și fără insigna „din OCR, neverificat”, evidențierea se stinge la refresh / Re-extrage — nu mai rămâne roșu doar pentru că OCR-ul a fost slab pe o poză anterioară.',
  },
  {
    name: 'Unește în Anexa XLSX',
    text: 'Bifează rândurile, verifică șablonul, apoi descarcă. Dacă selecția include neverificate, apare un modal cu carousel: poți edita pe loc (inclusiv document marfă TRO/PSL) sau continua oricum (îți asumi — bifezi explicit). Pe durata generării butonul e blocat. Valorile Default din șablon se scriu când pe aviz câmpul e gol sau 0. Opțiunea „Unește celulele TPO” grupează după TPO: fără Număr TPO, Unește e blocat — completezi TPO-ul, marchezi „Doar document marfă” (rămâne la coada Anexei), sau oprești bifa pe șablon.',
  },
];

export const TEMPLATE_ACTION_LEGEND = [
  {
    name: 'Cum se aplică',
    text: 'Cardul marcat „Folosit la export” este cel care ajunge în XLSX, îl poți schimba de aici cu „Folosește la export” sau din lista de lângă Unește, în tab-ul Avize OCR. „Implicit” este preselecția la deschiderea paginii — îl poți redenumi, nu îl poți șterge. Anexa Factura RAI are coloanele blocate (layout client); numele se poate schimba; pentru alt layout, duplică-l ca șablon nou.',
  },
  {
    name: 'Șablon nou / Editează',
    text: 'Definește coloanele XLSX: antetul din Excel, sursa (câmp din aviz) și Default dacă sursa e goală sau 0 (taxă, tarif, km). Bifă „Unește celulele TPO” ca pe Baumit: grupează și sudează Număr TPO în Excel pe toate cursele aceluiași TPO. În Confirmă / carusel fiecare aviz rămâne cu preview separat (PSL/TRO propriu) — sudura e doar în Anexă. Un șablon nou pornește de la cele 14 coloane ale Anexei. Numele e unic pe firmă (fără deosebire de majuscule): dacă „Șablon nou” e luat, se propune „Șablon nou (2)”; salvarea pe un nume existent e refuzată.',
  },
  {
    name: 'Șterge șablon',
    text: 'Elimină doar șablonul, nu avizele. Șablonul implicit și Anexa Factura RAI nu se șterg; alege alt implicit dacă vrei să cureți lista.',
  },
];

/** Anexa layout lock — by preset_id after rename, or historical name (#83). */
export function isLockedRai(t) {
  if (String(t?.preset_id || '').trim() === 'rai_anexa') return true;
  return String(t?.name || '').trim() === 'Anexa Factura RAI';
}

/** Implicit or locked Anexa — rename OK, delete blocked (#83). */
export function canDeleteTemplate(t) {
  if (!t) return false;
  if (t.is_default) return false;
  if (isLockedRai(t)) return false;
  return true;
}

/** Must stay aligned with `AVIZ_PAGE_SIZES` on the server. */
export const AVIZ_PAGE_SIZES = [20, 50, 100, 500];
export const AVIZ_DEFAULT_PAGE_SIZE = 50;
const AVIZ_PAGE_SIZE_KEY = 'transitix.avize.pageSize';

export function readAvizPageSize() {
  try {
    const n = Number(localStorage.getItem(AVIZ_PAGE_SIZE_KEY));
    if (AVIZ_PAGE_SIZES.includes(n)) return n;
  } catch {
    // Private window / blocked storage — fall through.
  }
  return AVIZ_DEFAULT_PAGE_SIZE;
}

export function writeAvizPageSize(n) {
  if (!AVIZ_PAGE_SIZES.includes(n)) return;
  try {
    localStorage.setItem(AVIZ_PAGE_SIZE_KEY, String(n));
  } catch {
    // Same as blur / offline: never block the screen for storage.
  }
}

/** Normalises GET /avize into `{ items, total, limit, offset }`. */
export function asAvizPage(res) {
  if (Array.isArray(res)) {
    return { items: res, total: res.length, limit: res.length, offset: 0 };
  }
  const items = Array.isArray(res?.items) ? res.items : [];
  return {
    items,
    total: Number(res?.total) || 0,
    limit: Number(res?.limit) || AVIZ_DEFAULT_PAGE_SIZE,
    offset: Number(res?.offset) || 0,
  };
}

export function formatIncarcareLabel(row, formatDate = (d) => d) {
  const date = row?.created_at ? formatDate(row.created_at) : '';
  const who = String(row?.uploaded_by_name || '').trim()
    || (row?.uploaded_from === 'driver' ? 'Șofer' : '');
  if (who && date) return `${who} · ${date}`;
  return who || date || '-';
}

/**
 * The fields Re-extrage rewrites from the file, mirrors `EXTRACT_COLUMNS` on the server, narrowed
 * to the ones the edit form can actually change. Km, taxe, valoare TPO and observations are absent
 * on purpose: extraction never touches them, so they are never at risk.
 *
 * Same set is the editable surface of Verificare OCR (#91): flagged route / weights / tip marfă /
 * document marfă must be correctable there, not only via Editează.
 */
export const OCR_OWNED_FIELDS = [
  'numar_tpo', 'data_efectuare_cursa', 'numar_auto', 'ruta_transport', 'tip_marfa',
  'cantitate_marfa', 'gross_weight_kg', 'net_weight_kg', 'numar_document_marfa',
];

/**
 * Draft keys for the HITL drawer: every OCR-owned column, plus any issue field that is not in
 * that list (defensive — a new finding key still gets an input).
 */
export function reviewDraftFromPayload(data) {
  const next = {};
  const values = data?.values || {};
  for (const key of OCR_OWNED_FIELDS) {
    const raw = values[key] ?? '';
    next[key] = key === 'data_efectuare_cursa' ? toDateIso(raw) : raw;
  }
  for (const issue of data?.issues || []) {
    if (!issue?.field || next[issue.field] !== undefined) continue;
    const raw = issue.value ?? values[issue.field] ?? '';
    next[issue.field] = issue.field === 'data_efectuare_cursa' ? toDateIso(raw) : raw;
  }
  return next;
}

function ocrValueFor(values, key) {
  // The extractor calls it `quantity`; the column is `cantitate_marfa`.
  if (key === 'cantitate_marfa') return values.cantitate_marfa ?? values.quantity;
  return values[key];
}

function comparable(value, key) {
  if (value === null || value === undefined) return '';
  const text = String(value).trim();
  if (key.startsWith('data_')) return text.slice(0, 10);
  return text;
}

function sameValue(current, extracted, key) {
  const a = comparable(current, key);
  const b = comparable(extracted, key);
  if (a === b) return true;
  if (a === '' || b === '') return false;
  const na = Number(a);
  const nb = Number(b);
  if (Number.isFinite(na) && Number.isFinite(nb)) return na === nb;
  return false;
}

/**
 * Which OCR-owned fields no longer match what the last extraction wrote.
 *
 * `corrected_fields` alone is not enough: it is only written by the corrections endpoint, while
 * the Editează modal saves through the generic entity update and leaves that column empty. So a
 * plain office edit has to be spotted by comparing the row against `extracted_data.values`.
 */
export function manuallyEditedAvizFields(row) {
  const edited = new Set(
    (Array.isArray(row?.corrected_fields) ? row.corrected_fields : [])
      .filter((key) => OCR_OWNED_FIELDS.includes(key))
  );
  const values = row?.extracted_data?.values;
  if (values && typeof values === 'object') {
    for (const key of OCR_OWNED_FIELDS) {
      if (!sameValue(row?.[key], ocrValueFor(values, key), key)) edited.add(key);
    }
  }
  return OCR_OWNED_FIELDS.filter((key) => edited.has(key));
}

export function hasManualAvizEdits(row) {
  return manuallyEditedAvizFields(row).length > 0;
}

/**
 * True when the modal draft differs from the seed snapshot on OCR-owned fields.
 * Compare form↔form (both from emptyForm / reviewDraft), not form↔row — formatting
 * mismatches were greying Re-extrage on open.
 */
export function formHasOcrDraftEdits(form, baselineForm) {
  if (!form || !baselineForm) return false;
  for (const key of OCR_OWNED_FIELDS) {
    const draft = key === 'data_efectuare_cursa' ? toDateIso(form[key]) : form[key];
    const base = key === 'data_efectuare_cursa'
      ? toDateIso(baselineForm[key])
      : baselineForm[key];
    if (!sameValue(draft, base, key)) return true;
  }
  return false;
}

/**
 * Grey out Re-extrage only after the operator types in the modal — not for saved edits.
 */
export function reextractBlockedReason(form, baselineForm) {
  if (form && baselineForm && formHasOcrDraftEdits(form, baselineForm)) {
    return 'Ai modificat câmpuri — Salvează sau revino la valorile din document ca să poți Re-extrage.';
  }
  return null;
}

/**
 * Same gate as server `annexExportReviewBlocked`: anexă must not ship OCR that still
 * needs a human. Prefer stored validation (DB), not list-decoration heuristics that
 * OR `needs_review` for low-confidence fields and would block after „Marchează verificat”.
 * Confirmed rows are clear even if an old flag lingered.
 */
export function requiresAnnexReviewGate(row) {
  if (!row || row.status === 'confirmed') return false;
  const stored = row.extracted_data?.validation ?? null;
  const routing = stored?.routing
    ?? row.validation_routing
    ?? null;
  if (routing === 'hitl_required') return true;
  if (stored && typeof stored.needs_review === 'boolean') {
    return stored.needs_review;
  }
  return Boolean(row.needs_review);
}

/** Selected rows (from the known page list) that still need review before annex export. */
export function annexReviewBlockedRows(rows, selectedIds) {
  const ids = new Set(selectedIds || []);
  return (rows || []).filter((r) => ids.has(r.id) && requiresAnnexReviewGate(r));
}

/** Same gate as confirm/HITL: queue for the force-confirm carousel, oldest upload first. */
export function confirmBlockedRows(rows, selectedIds) {
  return sortAvizeByUploadAsc(annexReviewBlockedRows(rows, selectedIds));
}

/**
 * Stable list / carousel order. Same keys as GET /api/avize (created_at, filename, id).
 * Edit / verify / re-extract must never reshuffle rows — only these immutable fields decide.
 */
export function compareAvizListOrder(a, b, { ascending = true } = {}) {
  const dir = ascending ? 1 : -1;
  const byCreated = String(a?.created_at || '').localeCompare(String(b?.created_at || ''));
  if (byCreated) return byCreated * dir;
  const byName = String(a?.original_filename || '').localeCompare(String(b?.original_filename || ''), 'ro');
  if (byName) return byName;
  return String(a?.id || '').localeCompare(String(b?.id || ''));
}

export function sortAvizeByUploadAsc(rows) {
  return [...(rows || [])].sort((a, b) => compareAvizListOrder(a, b, { ascending: true }));
}

/** Required keys in the Unește/Confirmă carousel (must stay aligned with CAROUSEL_EDIT_FIELDS). */
export const CAROUSEL_REQUIRED_KEYS = [
  'numar_tpo',
  'data_efectuare_cursa',
  'numar_auto',
  'ruta_transport',
];

/**
 * Essential fields for the force/export carousel (subset of AVIZ_FORM_FIELDS).
 * Includes every OCR-owned column so Confirmă can fix a flagged route / weight / tip marfă
 * without closing and opening Editează (#91).
 */
export const CAROUSEL_EDIT_FIELDS = [
  { key: 'numar_tpo', label: 'Număr TPO', required: true },
  { key: 'numar_document_marfa', label: 'Număr document marfă (TRO/PSL)', required: false },
  { key: 'data_efectuare_cursa', label: 'Data efectuare cursă', type: 'date', required: true },
  { key: 'numar_auto', label: 'Număr auto', required: true },
  { key: 'ruta_transport', label: 'Rută transport', wide: true, required: true },
  { key: 'tip_marfa', label: 'Tip marfă' },
  { key: 'cantitate_marfa', label: 'Cantitate (saci/galeți/m³/bucăți)', inputMode: 'decimal' },
  { key: 'gross_weight_kg', label: 'Greutate brută (kg)', inputMode: 'decimal' },
  { key: 'net_weight_kg', label: 'Greutate netă (kg)', inputMode: 'decimal' },
  { key: 'km_parcursi', label: 'Km parcurși', inputMode: 'decimal' },
  { key: 'taxe_suplimentare', label: 'Taxe suplimentare', inputMode: 'decimal' },
  { key: 'observatii', label: 'Observații', wide: true },
];

/** Baumit transfer / goods-only page: no transport TPO; TRO/PSL lives in numar_document_marfa. */
export function isGoodsDocOnly(row) {
  if (!row) return false;
  if (row.goods_doc_only === true) return true;
  return Boolean(row?.extracted_data?.goods_doc_only);
}

export function missingRequiredCarouselFields(source = {}) {
  const goodsOnly = isGoodsDocOnly(source);
  const missing = CAROUSEL_REQUIRED_KEYS.filter((key) => {
    if (key === 'numar_tpo' && goodsOnly) return false;
    const value = source[key];
    return value == null || String(value).trim() === '';
  });
  if (goodsOnly) {
    const doc = source?.numar_document_marfa;
    if (doc == null || String(doc).trim() === '') missing.push('numar_document_marfa');
  }
  return missing;
}

/** True when Număr TPO is blank (whitespace counts as missing). */
export function isMissingTpo(row) {
  return !String(row?.numar_tpo || '').trim();
}

/**
 * Selected / listed rows that still lack TPO — used when merge-TPO is ON.
 * Goods-doc-only rows (explicit flag) are allowed blank and sort to annex bottom.
 */
export function rowsMissingTpo(rows, ids = null) {
  const list = rows || [];
  const idSet = ids == null ? null : new Set(ids);
  return sortAvizeByUploadAsc(
    list.filter((r) => (
      (idSet == null || idSet.has(r.id))
      && isMissingTpo(r)
      && !isGoodsDocOnly(r)
    )),
  );
}

/**
 * TPO / auto / rută with low OCR that the operator has not yet accepted
 * (not in corrected_fields). Confirmed rows are clear.
 */
/** Digit-critical + route: low OCR must be acknowledged before annex (#88 includes PSL). */
export const OCR_VERIFY_KEYS = [
  'numar_tpo',
  'numar_document_marfa',
  'numar_auto',
  'data_efectuare_cursa',
  'ruta_transport',
];

export function unackedLowOcrFields(row) {
  if (!row || row.status === 'confirmed') return [];
  const corrected = new Set(
    Array.isArray(row.corrected_fields) ? row.corrected_fields : [],
  );
  const goodsOnly = isGoodsDocOnly(row);
  return OCR_VERIFY_KEYS.filter((key) => {
    if (goodsOnly && key === 'numar_tpo') return false;
    if (corrected.has(key)) return false;
    return lowField(row, key);
  });
}

export function rowsNeedingOcrVerify(rows, ids = null) {
  const list = rows || [];
  const idSet = ids == null ? null : new Set(ids);
  return sortAvizeByUploadAsc(
    list.filter((r) => (idSet == null || idSet.has(r.id)) && unackedLowOcrFields(r).length > 0),
  );
}

/**
 * Carousel walks empty required fields and unacked OCR-low TPO/auto/rută.
 * HITL without gaps or low confidence still blocks export, but needs no edit page.
 */
export function rowsNeedingCarouselEdit(rows) {
  return sortAvizeByUploadAsc(
    (rows || []).filter((r) => (
      missingRequiredCarouselFields(r).length > 0
      || unackedLowOcrFields(r).length > 0
    )),
  );
}

/**
 * HITL / „Verificare obligatorie” still open on the selection.
 * Confirm must not claim „Gata de confirmare” for these — warn the operator to
 * check address and other OCR fields carefully (bug #95).
 */
export function rowsNeedingHitlCaution(rows, ids = null) {
  const list = rows || [];
  const idSet = ids == null ? null : new Set(ids);
  return sortAvizeByUploadAsc(
    list.filter((r) => (idSet == null || idSet.has(r.id)) && requiresAnnexReviewGate(r)),
  );
}

/** Normalize TPO for grouping (trim + upper). Empty → ''. */
export function normalizeTpoKey(value) {
  return String(value || '').trim().toUpperCase();
}

/**
 * Consecutive peers sharing the same TPO around `focusId` in upload order.
 * Kept for annex helpers / tests — Confirmă carousel no longer stacks their
 * previews (#109); each aviz is reviewed alone (PSL/TRO own fields).
 *
 * @param {Array<{ id: string, numar_tpo?: string|null, file_url?: string|null }>} rows
 * @param {string|null|undefined} focusId
 * @returns {typeof rows}
 */
export function consecutiveSameTpoPeers(rows, focusId) {
  const ordered = sortAvizeByUploadAsc(rows);
  if (!ordered.length) return [];
  const at = ordered.findIndex((r) => r.id === focusId);
  if (at < 0) return [];
  const key = normalizeTpoKey(ordered[at]?.numar_tpo);
  if (!key) return [ordered[at]];
  let lo = at;
  let hi = at;
  while (lo > 0 && normalizeTpoKey(ordered[lo - 1]?.numar_tpo) === key) lo -= 1;
  while (hi < ordered.length - 1 && normalizeTpoKey(ordered[hi + 1]?.numar_tpo) === key) hi += 1;
  return ordered.slice(lo, hi + 1);
}

/** Distinct file_url list for glued preview (skip blanks / duplicates). */
export function previewFileUrlsForPeers(peers) {
  const seen = new Set();
  const urls = [];
  for (const row of peers || []) {
    const url = String(row?.file_url || '').trim();
    if (!url || url.startsWith('manual://') || seen.has(url)) continue;
    seen.add(url);
    urls.push(url);
  }
  return urls;
}

export function annexReviewBlockedMessage(count) {
  const n = Number(count) || 0;
  if (n <= 0) return null;
  if (n === 1) {
    return '1 document necesită verificare. Deschide Verifică / Confirmă înainte de anexă.';
  }
  return `${n} documente necesită verificare. Deschide Verifică / Confirmă înainte de anexă.`;
}

/** Field labels for the re-extract warning, so the operator sees what is about to be rewritten. */
export function manualAvizEditLabels(row) {
  const labels = new Map(AVIZ_FORM_FIELDS.map((f) => [f.key, f.label]));
  return manuallyEditedAvizFields(row).map((key) => labels.get(key) || key);
}

export function columnCountOf(t) {
  return Array.isArray(t?.columns) ? t.columns.length : 0;
}

export function emptyForm(row = {}) {
  const form = {};
  for (const f of AVIZ_FORM_FIELDS) {
    const raw = row[f.key];
    if (f.type === 'date') {
      form[f.key] = toDateIso(raw ?? '');
    } else {
      // Always strings for controlled text inputs — pg NUMERIC / JSON numbers in the
      // row used to leave number values that fought React on every blur/tab.
      form[f.key] = raw == null || raw === '' ? '' : String(raw);
    }
  }
  form.ruta_display = row.ruta_display == null ? '' : String(row.ruta_display);
  form.trip_id = row.trip_id ?? '';
  form.goods_doc_only = isGoodsDocOnly(row);
  // Zone fee lines written by the Taxă zonă panel (#98) — not a form field, saved into extracted_data.
  const ed = row.extracted_data && typeof row.extracted_data === 'object' ? row.extracted_data : {};
  form.zone_tax_breakdown = ed.zone_tax_breakdown == null ? '' : String(ed.zone_tax_breakdown);
  return form;
}

/**
 * Split labels look like `lot.pdf · aviz 4/13 · pag. 6` — fine in the UI, fatal as a
 * download name (extension is no longer at the end → Windows / Preview won't open as PDF).
 * Rebuild: stem + safe suffix + real extension.
 */
export function safeDownloadFilename(name, { fallbackExt = 'pdf' } = {}) {
  const raw = String(name || '').trim() || `document.${fallbackExt}`;
  const parts = raw.split(/\s*·\s*/).map((p) => p.trim()).filter(Boolean);
  const head = parts[0] || `document.${fallbackExt}`;
  const extMatch = head.match(/^(.*?)(\.[A-Za-z0-9]{1,8})$/);
  const stem = (extMatch ? extMatch[1] : head).trim() || 'document';
  const ext = (extMatch ? extMatch[2].slice(1) : fallbackExt).toLowerCase() || fallbackExt;
  const suffix = parts.slice(1)
    .join('-')
    .replace(/[–—]/g, '-')
    .replace(/\//g, '-')
    .replace(/\./g, '') // "pag. 6" → "pag-6", not "pag.-6"
    .replace(/\s+/g, '-');
  let out = suffix ? `${stem}-${suffix}.${ext}` : `${stem}.${ext}`;
  out = out
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_')
    .replace(/_+/g, '_')
    .replace(/-+/g, '-')
    .replace(/^[-_.]+|[-_.]+$/g, '');
  if (!out.toLowerCase().endsWith(`.${ext}`)) out = `${out || 'document'}.${ext}`;
  return out;
}

export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = safeDownloadFilename(filename);
  a.click();
  URL.revokeObjectURL(url);
}

/**
 * Email stub fallback: download the annex once per modal attempt, not on every Trimite click.
 */
export function shouldAutoDownloadEmailFallback({ alreadyDownloaded, hasContent }) {
  return Boolean(hasContent) && !alreadyDownloaded;
}

export function displayRoute(row) {
  return String(row?.ruta_display || '').trim() || row?.ruta_transport || '';
}

/** True when extract/list applied a company route rule learned from a prior Editează. */
export function isLearnedRoute(row) {
  return row?.extracted_data?.route_source === 'learned';
}

/** True when the Expeditor street was unreadable and came from the company's learned addresses (#112). */
export function isMemoryOrigin(row) {
  return row?.extracted_data?.origin_source === 'memory'
    && !(Array.isArray(row?.corrected_fields) && row.corrected_fields.includes('ruta_transport'));
}

/** True when a delivery street was unreadable and came from the company's learned addresses. */
export function isMemoryDelivery(row) {
  return row?.extracted_data?.delivery_source === 'memory'
    && !(Array.isArray(row?.corrected_fields) && row.corrected_fields.includes('ruta_transport'));
}

/** Which legs of the route came from learned addresses: `origine`, `livrare`, both, or null. */
export function memoryRouteLabel(row) {
  const origin = isMemoryOrigin(row);
  const delivery = isMemoryDelivery(row);
  if (origin && delivery) return 'origine și livrare';
  if (origin) return 'origine';
  if (delivery) return 'livrare';
  return null;
}

/**
 * Re-extrage returns 202 and finishes in the background. Poll until the row leaves
 * `uploaded` (or we give up), so the list/form show the new fields instead of the
 * pre-extract snapshot that load() would otherwise race with.
 *
 * @param {string} id
 * @param {(id: string) => Promise<object|null|undefined>} fetchRow
 * @param {{ intervalMs?: number, timeoutMs?: number, sleep?: (ms: number) => Promise<void> }} [opts]
 */
export async function waitForAvizExtractSettled(id, fetchRow, {
  intervalMs = 800,
  timeoutMs = 90_000,
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
} = {}) {
  const started = Date.now();
  let last = null;
  while (Date.now() - started < timeoutMs) {
    // eslint-disable-next-line no-await-in-loop
    last = await fetchRow(id);
    if (!last) return null;
    if (last.status !== 'uploaded') return last;
    // eslint-disable-next-line no-await-in-loop
    await sleep(intervalMs);
  }
  return last;
}

/**
 * Amber / red OCR flag for one field. Accepts decorateAviz `low`/`ok` strings and the
 * raw extractor objects `{ confidence, status }` stored on the row.
 */
export function lowField(row, key) {
  const v = row?.field_confidence?.[key];
  if (v === 'low') return true;
  if (v === 'ok' || v == null) return false;
  if (typeof v === 'object') {
    if (v.status === 'review' || v.status === 'missing') return true;
    if (v.status === 'ok') return false;
    const conf = Number(v.confidence);
    if (Number.isFinite(conf)) return conf < 0.8;
  }
  return false;
}

/** Show Re-extrage in modals only when at least this many OCR fields look empty / wrong. */
export const REEXTRACT_MIN_TROUBLED_FIELDS = 3;

/**
 * Count OCR-owned fields that are empty in the draft (or row) or marked OCR-unsure / finding.
 * „Doar document marfă” skips Număr TPO (allowed blank).
 */
export function countTroubledOcrFields(row, { form = null, findings = null } = {}) {
  if (!row && !form) return 0;
  const goodsOnly = isGoodsDocOnly(form || row);
  const findingList = Array.isArray(findings)
    ? findings
    : (row?.validation_findings
      ?? row?.extracted_data?.validation?.findings
      ?? []);
  const findingFields = new Set(
    findingList
      .filter((f) => f && f.field && (f.severity === 'error' || f.severity === 'warning'))
      .map((f) => f.field),
  );
  let n = 0;
  for (const key of OCR_OWNED_FIELDS) {
    if (goodsOnly && key === 'numar_tpo') continue;
    const raw = form?.[key] !== undefined && form?.[key] !== null
      ? form[key]
      : row?.[key];
    const empty = !String(raw ?? '').trim();
    if (empty || lowField(row, key) || findingFields.has(key)) n += 1;
  }
  return n;
}

/** Modal Re-extrage banner — only when OCR is clearly struggling (≥ 3 troubled fields). */
export function shouldOfferReextract(row, opts = {}) {
  return countTroubledOcrFields(row, opts) >= REEXTRACT_MIN_TROUBLED_FIELDS;
}

/** List / table class when OCR confidence on a field is low. */
export const LOW_FIELD_TEXT_CLS = 'text-red-700 font-bold';

/**
 * Compact status-color strip under Șterge selectate (dots + short labels).
 * HITL amber matches NeedsReviewBadge; red matches LOW_FIELD_TEXT_CLS.
 */
export const AVIZ_STATUS_DOT_LEGEND = [
  { key: 'uploaded', label: 'Se procesează', dotCls: 'bg-sky-500' },
  { key: 'extracted', label: 'Extras', dotCls: 'bg-slate-400' },
  { key: 'confirmed', label: 'Confirmat', dotCls: 'bg-emerald-500' },
  { key: 'hitl', label: 'Verificare obligatorie', dotCls: 'bg-amber-500' },
  { key: 'ocr', label: 'OCR nesigur', dotCls: 'bg-red-600' },
];

export const AVIZ_STATUS_DOT_ONELINER =
  'Bulinele = status în coloana Stare; text roșu bold pe TPO / auto / rută = OCR nesigur — Confirmă / Unește blocate până verifici pe document (Verifică sau Salvează în carusel). Auto roșu dispare când plăcuța e în Autoturisme cu MTMA completat și fără „din OCR, neverificat” (la refresh listă sau după Re-extrage).';

/**
 * Absence / “field empty” rules — hide once Editează has a value (#81).
 * Wrong-but-plausible OCR (low confidence, bad format) must stay visible (#88).
 */
const ABSENCE_FINDING_RULES = new Set([
  'tpo_missing',
  'date_missing',
  'plate_missing',
  'doc_no_missing',
  'gross_missing_near_net',
  'net_missing_near_gross',
  'weights_missing',
  'goods_missing',
  'ruta_missing',
]);

/**
 * Validation findings stored on extract (decorateAviz also mirrors them as validation_findings).
 * Info / duplicate badges stay out of the edit-form review strip.
 */
export function avizEditFindings(row, { form } = {}) {
  const raw = row?.validation_findings
    ?? row?.extracted_data?.validation?.findings
    ?? [];
  if (!Array.isArray(raw) || !raw.length) return [];
  const seen = new Set();
  const out = [];
  for (const f of raw) {
    if (!f || f.severity === 'info' || f.source === 'duplicate_suspect') continue;
    if (f.severity !== 'error' && f.severity !== 'warning') continue;
    // Only clear *missing* findings when the operator filled the box. Keep low-confidence
    // / invalid-format warnings on a filled wrong PSL (#88 reopen).
    if (
      form
      && f.field
      && String(form[f.field] ?? '').trim()
      && (ABSENCE_FINDING_RULES.has(f.rule) || /_missing$/.test(String(f.rule || '')))
    ) {
      continue;
    }
    const key = `${f.rule}|${f.field || ''}|${f.message || ''}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(f);
  }
  return out;
}

/** Findings that belong under one form field (or under the strip when field is null). */
export function findingsForField(findings, fieldKey) {
  if (!Array.isArray(findings) || !fieldKey) return [];
  return findings.filter((f) => f.field === fieldKey);
}
