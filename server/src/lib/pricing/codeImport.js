/**
 * Importing the customer's own observation codes.
 *
 * The codes on the delivery notes (`DM`, `Z:B*`, `IF*`) are theirs, not ours — the brief is
 * explicit that we must not invent the list. So this reads their sheet and takes what is there,
 * rather than mapping it onto a vocabulary we made up.
 */

/** Header names we recognise, in the several ways a Romanian spreadsheet writes them. */
const HEADERS = {
  code: ['cod', 'code', 'cod observatie', 'cod observație'],
  label: ['descriere', 'denumire', 'label', 'description', 'explicatie', 'explicație'],
  kind: ['tip', 'kind', 'categorie', 'type'],
  active: ['activ', 'active', 'valabil'],
};

function normaliseHeader(value) {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '');
}

/** Maps a sheet's header row onto our field names. Unknown columns are ignored, not guessed. */
export function mapHeaders(row = []) {
  const out = {};
  row.forEach((cell, index) => {
    const name = normaliseHeader(cell);
    for (const [field, names] of Object.entries(HEADERS)) {
      if (names.some((candidate) => normaliseHeader(candidate) === name)) out[field] = index;
    }
  });
  return out;
}

/** "nu", "0", "fals" and "inactiv" all mean inactive; anything else present means active. */
export function readActive(value) {
  if (value === null || value === undefined || String(value).trim() === '') return true;
  const text = String(value).trim().toLowerCase();
  if (['nu', 'no', 'n', '0', 'fals', 'false', 'inactiv'].includes(text)) return false;
  return true;
}

/**
 * Turns sheet rows into codes, reporting what it could not use.
 *
 * A silently skipped row is how half a customer's code list goes missing without anyone
 * noticing until a report comes out wrong, so every rejection is named and counted.
 */
export function parseCodeRows(rows = []) {
  if (!rows.length) {
    return { codes: [], skipped: [], error: 'Fișierul e gol.' };
  }

  const headers = mapHeaders(rows[0]);
  if (headers.code === undefined) {
    return {
      codes: [],
      skipped: [],
      error: 'Nu găsesc coloana „Cod". Antetul trebuie să conțină: Cod | Descriere | Tip | Activ.',
    };
  }

  const codes = [];
  const skipped = [];
  const seen = new Set();

  rows.slice(1).forEach((row, offset) => {
    const line = offset + 2;
    const code = String(row?.[headers.code] ?? '').trim();
    if (!code) {
      // A blank line at the end of a sheet is normal; a blank code mid-list is not, but either
      // way it is reported rather than dropped.
      if (row?.some((cell) => String(cell ?? '').trim())) {
        skipped.push({ line, reason: 'fără cod' });
      }
      return;
    }
    if (seen.has(code.toLowerCase())) {
      skipped.push({ line, code, reason: 'cod duplicat în fișier' });
      return;
    }
    seen.add(code.toLowerCase());

    codes.push({
      code: code.slice(0, 40),
      label: headers.label === undefined ? null : (String(row[headers.label] ?? '').trim() || null),
      kind: headers.kind === undefined ? null : (String(row[headers.kind] ?? '').trim() || null),
      is_active: headers.active === undefined ? true : readActive(row[headers.active]),
      sort_order: codes.length + 1,
    });
  });

  return { codes, skipped, error: null };
}
