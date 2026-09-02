import { AVIZ_FORM_FIELDS } from '@/lib/avizAnnex';

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
    text: 'Marchează rândul ca verificat (status Confirmat). Nu blochează exportul — poți uni și rânduri neverificate, dar Confirmă e semnul că datele sunt gata de factură.',
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
    name: 'TPO duplicat',
    text: 'Același număr TPO există deja pe alt rând. Eticheta este un semnal vizual — nu blochează acțiunile, dar la Confirmă sau export primești un avertisment. Pentru încărcări greșite, folosește Șterge.',
  },
  {
    name: 'Unește în Anexa XLSX',
    text: 'Bifează rândurile, verifică șablonul din lista de lângă buton (scrie câte coloane exportă), apoi descarcă. Valorile Default din șablon (ex. Taxă 100, Tarif km 20) se scriu în Excel când pe aviz câmpul e gol sau 0.',
  },
];

export const TEMPLATE_ACTION_LEGEND = [
  {
    name: 'Cum se aplică',
    text: 'Cardul marcat „Folosit la export” este cel care ajunge în XLSX — îl poți schimba de aici cu „Folosește la export” sau din lista de lângă Unește, în tab-ul Avize. „Implicit” este doar preselecția la deschiderea paginii. Anexa Factura RAI nu se poate suprascrie — duplică-l ca șablon nou.',
  },
  {
    name: 'Șablon nou / Editează',
    text: 'Definește coloanele XLSX: antetul din Excel, sursa (câmp din aviz) și Default dacă sursa e goală sau 0 (taxă, tarif, km). Un șablon nou pornește de la cele 14 coloane ale Anexei — șterge-le pe cele care nu îți trebuie, pentru că exportul scrie exact ce rămâne salvat. Un șablon fără nicio coloană nu se salvează.',
  },
  {
    name: 'Șterge șablon',
    text: 'Elimină doar șablonul, nu avizele. Păstrează Anexa Factura RAI dacă vrei exportul standard pe 14 coloane.',
  },
];

export function isLockedRai(t) {
  return String(t?.name || '').trim() === 'Anexa Factura RAI';
}

export function formatIncarcareLabel(row, formatDate = (d) => d) {
  const date = row?.created_at ? formatDate(row.created_at) : '';
  const who = String(row?.uploaded_by_name || '').trim()
    || (row?.uploaded_from === 'driver' ? 'Șofer' : '');
  if (who && date) return `${who} · ${date}`;
  return who || date || '—';
}

/**
 * The fields Re-extrage rewrites from the file — mirrors `EXTRACT_COLUMNS` on the server, narrowed
 * to the ones the edit form can actually change. Km, taxe, valoare TPO and observations are absent
 * on purpose: extraction never touches them, so they are never at risk.
 */
const OCR_OWNED_FIELDS = [
  'numar_tpo', 'data_efectuare_cursa', 'numar_auto', 'ruta_transport', 'tip_marfa',
  'cantitate_marfa', 'numar_document_marfa',
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
    form[f.key] = row[f.key] ?? '';
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

export function displayRoute(row) {
  return String(row?.ruta_display || '').trim() || row?.ruta_transport || '';
}

export function lowField(row, key) {
  return row?.field_confidence?.[key] === 'low';
}
