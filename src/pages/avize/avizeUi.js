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
    text: 'Corectează extracția sau completează câmpurile care nu sunt pe aviz (km, tarif, taxe, observații). Salvarea rămâne după refresh, inclusiv dată, auto, rută și document. Folosește Re-extrage doar dacă vrei din nou valorile din PDF.',
  },
  {
    name: 'Confirmă',
    text: 'Marchează rândul ca verificat (status Confirmat) doar dacă validarea OCR a trecut. Dacă apare „De revizuit” / HITL, deschide Verificare, corectează și marchează verificat - altfel Confirmă e blocat (admin poate forța cu motiv).',
  },
  {
    name: 'Verificare OCR',
    text: 'Deschide imaginea lângă câmpurile problematice (încredere scăzută, regulă eșuată, duplicat). Salvează corecțiile (audit old→new) apoi Marchează verificat.',
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
    text: 'Același transport există deja pe alt rând, adică același număr de aviz (PSL/TRO) sub același TPO. Un TPO cu mai multe curse nu primește eticheta: acelea sunt avize diferite și rămân rânduri separate. Eticheta nu blochează nimic, dar la Confirmă sau export primești un avertisment. Pentru încărcări greșite, folosește Șterge.',
  },
  {
    name: 'Unește în Anexa XLSX',
    text: 'Bifează rândurile, verifică șablonul din lista de lângă buton (scrie câte coloane exportă), apoi descarcă. Valorile Default din șablon (ex. Taxă 100, Tarif km 20) se scriu în Excel când pe aviz câmpul e gol sau 0.',
  },
];

export const TEMPLATE_ACTION_LEGEND = [
  {
    name: 'Cum se aplică',
    text: 'Cardul marcat „Folosit la export” este cel care ajunge în XLSX, îl poți schimba de aici cu „Folosește la export” sau din lista de lângă Unește, în tab-ul Avize OCR. „Implicit” este doar preselecția la deschiderea paginii. Anexa Factura RAI nu se poate suprascrie, duplică-l ca șablon nou.',
  },
  {
    name: 'Șablon nou / Editează',
    text: 'Definește coloanele XLSX: antetul din Excel, sursa (câmp din aviz) și Default dacă sursa e goală sau 0 (taxă, tarif, km). Un șablon nou pornește de la cele 14 coloane ale Anexei, șterge-le pe cele care nu îți trebuie, pentru că exportul scrie exact ce rămâne salvat. Un șablon fără nicio coloană nu se salvează.',
  },
  {
    name: 'Șterge șablon',
    text: 'Elimină doar șablonul, nu avizele. Păstrează Anexa Factura RAI dacă vrei exportul standard pe 14 coloane.',
  },
];

export function isLockedRai(t) {
  return String(t?.name || '').trim() === 'Anexa Factura RAI';
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
 */
const OCR_OWNED_FIELDS = [
  'numar_tpo', 'data_efectuare_cursa', 'numar_auto', 'ruta_transport', 'tip_marfa',
  'cantitate_marfa', 'gross_weight_kg', 'net_weight_kg', 'numar_document_marfa',
];

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
    const raw = row[f.key] ?? '';
    form[f.key] = f.type === 'date' ? toDateIso(raw) : raw;
  }
  form.ruta_display = row.ruta_display ?? '';
  form.trip_id = row.trip_id ?? '';
  return form;
}

export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
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

export function lowField(row, key) {
  return row?.field_confidence?.[key] === 'low';
}
