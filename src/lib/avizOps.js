export function bucharestYmd(date = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Bucharest',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

function addDays(ymd, days) {
  const [y, m, d] = ymd.split('-').map(Number);
  const utc = Date.UTC(y, m - 1, d + days);
  return bucharestYmd(new Date(utc));
}

/** Monday-start week in Europe/Bucharest calendar dates. */
export function datePresetRange(preset, now = new Date()) {
  const today = bucharestYmd(now);
  if (preset === 'today') return { from: today, to: today };
  if (preset === 'month') {
    const [y, m] = today.split('-');
    const from = `${y}-${m}-01`;
    const last = new Date(Date.UTC(Number(y), Number(m), 0));
    const to = `${y}-${m}-${String(last.getUTCDate()).padStart(2, '0')}`;
    return { from, to };
  }
  if (preset === 'week') {
    const [y, m, d] = today.split('-').map(Number);
    const weekday = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
    const mondayOffset = weekday === 0 ? -6 : 1 - weekday;
    const from = addDays(today, mondayOffset);
    const to = addDays(from, 6);
    return { from, to };
  }
  return { from: '', to: '' };
}

export function normalizeExtractionSource(provider) {
  const p = String(provider || '').toLowerCase().replace(/_/g, '-');
  if (p === 'pdf-text' || p === 'pdftext') return 'pdf-text';
  if (p === 'vision' || p === 'google-vision' || p === 'google_vision') return 'vision';
  return 'stub';
}

export function isLowConfidenceTpo(value) {
  const s = String(value || '').trim();
  if (!s) return true;
  if (/^TPO-\d+$/i.test(s)) return false;
  return /^(mpi|adeziv|adresa)\b/i.test(s);
}

export function isLowConfidenceAuto(value) {
  const s = String(value || '').trim();
  if (!s) return true;
  if (s.length > 48) return true;
  return /document de test|fara valoare|materiale demonstrative|buildtest/i.test(s);
}

export function avizFieldConfidence(row) {
  return {
    numar_tpo: isLowConfidenceTpo(row?.numar_tpo) ? 'low' : 'ok',
    numar_auto: isLowConfidenceAuto(row?.numar_auto) ? 'low' : 'ok',
    ruta_transport: String(row?.ruta_transport || '').trim() ? 'ok' : 'low',
  };
}

export function annexDraftAmount(row, rule = 'tpo') {
  const tpo = Number(row?.valoare_tpo) || 0;
  const km = Number(row?.km_parcursi) || 0;
  const tarif = Number(row?.tarif_km) || 0;
  if (rule === 'km_tarif') return Math.round(km * tarif * 100) / 100;
  return tpo;
}

export function previewKind(url) {
  const s = String(url || '').split('?')[0].toLowerCase();
  if (s.endsWith('.pdf')) return 'pdf';
  if (/\.(png|jpe?g|gif|webp)$/.test(s)) return 'image';
  return 'file';
}

/** Bucharest calendar date for when the file reached us — mirrors the server list filter. */
export function avizIncarcareDate(row) {
  if (!row?.created_at) return '';
  return bucharestYmd(new Date(row.created_at));
}

function avizFilterDate(row, dateField = 'cursa') {
  if (dateField === 'incarcare') return avizIncarcareDate(row);
  const cursa = String(row?.data_efectuare_cursa || '').slice(0, 10);
  return cursa || avizIncarcareDate(row);
}

/** Client-side mirror of `buildAvizListQuery` so we can tell when a row is hidden by filters. */
export function avizMatchesListFilters(row, filters = {}) {
  if (!row) return false;
  const dateField = filters.date_field === 'incarcare' ? 'incarcare' : 'cursa';
  const dateValue = avizFilterDate(row, dateField);

  if (filters.from) {
    if (!dateValue || dateValue < filters.from) return false;
  }
  if (filters.to) {
    if (!dateValue || dateValue > filters.to) return false;
  }
  if (filters.status && row.status !== filters.status) return false;
  if (filters.uploaded_from && row.uploaded_from !== filters.uploaded_from) return false;

  const term = String(filters.q || '').trim().toLowerCase();
  if (term) {
    const hay = [
      row.numar_tpo,
      row.numar_auto,
      row.numar_document_marfa,
      row.original_filename,
    ].filter(Boolean).join(' ').toLowerCase();
    if (!hay.includes(term)) return false;
  }
  return true;
}

/** After an upload, widen the date filter to the upload day(s) so fresh rows are visible. */
export function filtersToRevealUploads(uploadedRows = []) {
  const dates = uploadedRows.map(avizIncarcareDate).filter(Boolean);
  if (!dates.length) return null;
  return {
    date_field: 'incarcare',
    from: dates.reduce((min, d) => (d < min ? d : min)),
    to: dates.reduce((max, d) => (d > max ? d : max)),
  };
}
